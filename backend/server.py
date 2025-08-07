import os
import asyncio
import logging
import uuid
import base64
from typing import Dict, Optional
import socketio
import uvicorn
from backend.gemini_client import GeminiClient

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Create a Socket.IO AsyncServer
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = socketio.ASGIApp(sio)

# In-memory dictionary to store session mappings
sessions: Dict[str, str] = {}

# Gemini client instance
gemini_client: Optional[GeminiClient] = None


@sio.event
async def connect(sid, environ):
    """
    Handle client connection event.
    
    Args:
        sid: Socket ID assigned to the client
        environ: WSGI environment dictionary
    """
    # Generate a unique session ID for the Gemini client
    session_id = str(uuid.uuid4())
    sessions[sid] = session_id
    logger.info(f"Client connected: {sid}, assigned Gemini session: {session_id}")
    await sio.emit('connect_success', {'status': 'connected'}, room=sid)


@sio.event
async def disconnect(sid):
    """
    Handle client disconnection event.
    
    Args:
        sid: Socket ID of the disconnecting client
    """
    if sid in sessions:
        session_id = sessions[sid]
        logger.info(f"Client disconnected: {sid}, cleaning up session: {session_id}")
        
        # Clean up the Gemini session
        if gemini_client:
            gemini_client.close_session(session_id)
        
        # Remove from our session mapping
        del sessions[sid]
    else:
        logger.warning(f"Client disconnected: {sid}, but no session found")


@sio.on('audio_chunk')
async def handle_audio_chunk(sid, data):
    """
    Process incoming audio chunks from the client.
    
    Args:
        sid: Socket ID of the client
        data: Dictionary containing the audio data and metadata
    """
    if sid not in sessions:
        logger.error(f"Received audio from unknown session: {sid}")
        await sio.emit('error', {'message': 'Session not found'}, room=sid)
        return
    
    session_id = sessions[sid]
    
    try:
        # Extract audio data and flags
        audio_data = data.get('audio')
        is_final = data.get('is_final', False)
        
        # Check if audio is base64 encoded
        if isinstance(audio_data, str):
            try:
                audio_bytes = base64.b64decode(audio_data)
            except Exception as e:
                logger.error(f"Failed to decode base64 audio: {e}")
                await sio.emit('error', {'message': 'Invalid audio encoding'}, room=sid)
                return
        elif isinstance(audio_data, bytes):
            audio_bytes = audio_data
        else:
            logger.error(f"Invalid audio data type: {type(audio_data)}")
            await sio.emit('error', {'message': 'Invalid audio data'}, room=sid)
            return
        
        logger.debug(f"Processing audio chunk: {len(audio_bytes)} bytes, is_final: {is_final}")
        
        # Process the audio through Gemini
        transcript_text = ""
        async for text_chunk in gemini_client.stream_chat(audio_bytes, session_id):
            transcript_text += text_chunk
            # Send incremental responses back to the client
            await sio.emit('transcript_chunk', {
                'text': text_chunk,
                'is_final': False
            }, room=sid)
        
        # Signal completion of processing
        if is_final:
            await sio.emit('transcript_chunk', {
                'text': transcript_text,
                'is_final': True
            }, room=sid)
            await sio.emit('ai_response_done', room=sid)
            
    except Exception as e:
        logger.error(f"Error processing audio chunk: {str(e)}")
        await sio.emit('error', {'message': f'Processing error: {str(e)}'}, room=sid)


async def initialize_gemini():
    """Initialize the Gemini client using the API key from environment variables."""
    global gemini_client
    api_key = os.environ.get("GOOGLE_API_KEY")
    gemini_client = GeminiClient(api_key)
    logger.info("Gemini client initialized")


@sio.event
async def connect_error(data):
    """Log connection errors."""
    logger.error(f"Connection error: {data}")


def start_server(host: str = '0.0.0.0', port: int = 8000):
    """
    Start the Socket.IO server.
    
    Args:
        host: Hostname to bind the server to
        port: Port number to listen on
    """
    # Run initialization on startup
    app.on_startup = [initialize_gemini]
    
    # Start the server
    logger.info(f"Starting server on {host}:{port}")
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    # Read configuration from environment variables
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    
    # Start the server
    start_server(host, port)