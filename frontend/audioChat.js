// Audio Chat Application Client-Side Logic

// Initialize socket connection
const socket = io();

// DOM elements
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const statusArea = document.getElementById('statusArea');
const userCountElement = document.getElementById('userCount');

// Audio variables
let mediaRecorder;
let audioContext;
let audioStream;
let recordedChunks = [];

// Add event listeners to buttons
startButton.addEventListener('click', startAudioChat);
stopButton.addEventListener('click', stopAudioChat);

// Function to add messages to the status area
function updateStatus(message) {
    const messageElement = document.createElement('p');
    messageElement.textContent = message;
    statusArea.appendChild(messageElement);
    statusArea.scrollTop = statusArea.scrollHeight; // Auto-scroll to bottom
}

// Start audio chat
async function startAudioChat() {
    try {
        // Request microphone access
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Initialize the MediaRecorder with the audio stream
        mediaRecorder = new MediaRecorder(audioStream);
        
        // Set up the AudioContext for playback
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Handle dataavailable event (fired when timeslice is reached)
        mediaRecorder.addEventListener('dataavailable', event => {
            if (event.data.size > 0) {
                // Send the audio chunk to the server
                socket.emit('audio', event.data);
            }
        });
        
        // Start recording with 250ms timeslices
        mediaRecorder.start(250);
        
        // Update UI
        startButton.disabled = true;
        stopButton.disabled = false;
        updateStatus('Audio chat started. You are now broadcasting.');
        
    } catch (error) {
        console.error('Error accessing microphone:', error);
        updateStatus(`Error: Could not access microphone - ${error.message}`);
    }
}

// Stop audio chat
function stopAudioChat() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    
    // Close audio tracks
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
    
    // Update UI
    startButton.disabled = false;
    stopButton.disabled = true;
    updateStatus('Audio chat stopped.');
}

// Play received audio
async function playAudio(audioBlob) {
    try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // Create a source node
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        
        // Connect to audio output
        source.connect(audioContext.destination);
        
        // Play the audio
        source.start(0);
    } catch (error) {
        console.error('Error playing audio:', error);
    }
}

// Socket.io event listeners
socket.on('connect', () => {
    updateStatus('Connected to server.');
});

socket.on('disconnect', () => {
    updateStatus('Disconnected from server.');
    stopAudioChat();
});

socket.on('audio', (audioChunk) => {
    // Convert the received audio chunk to a Blob
    const audioBlob = new Blob([audioChunk], { type: 'audio/webm; codecs=opus' });
    playAudio(audioBlob);
});

socket.on('status', (data) => {
    userCountElement.textContent = data.clients;
    updateStatus(`Connected to server with ${data.clients} total users.`);
});

socket.on('user-joined', (data) => {
    userCountElement.textContent = data.totalClients;
    updateStatus(`New user joined. Total users: ${data.totalClients}`);
});

// Initial status message
updateStatus('Welcome to Audio Chat. Click "Start Chat" to begin.');

// Ensure resources are cleaned up when page is closed
window.addEventListener('beforeunload', () => {
    stopAudioChat();
    if (audioContext) {
        audioContext.close();
    }
});