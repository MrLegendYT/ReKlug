// ====================================================================
// recorder.js (UPDATED: WEB CAM AND MIC FUNCTIONALITY REMOVED)
// ====================================================================

let mediaRecorder;
let recordedChunks = [];
let timerInterval;
let seconds = 0;
let currentBlob = null; 
let controlPopup = null;
let isPaused = false;
let audioContext;
let screenStreamGlobal = null;
let micStreamGlobal = null; 
// webcamStreamGlobal is implicitly removed/ignored

// References to DOM elements 
const livePreview = document.getElementById('livePreview');
const timerDisplay = document.getElementById('recordingTimer');
const recordingInterface = document.getElementById('recording-interface');
const postModal = document.getElementById('postModal');
const finalReviewVideo = document.getElementById('finalReviewVideo');
const homeView = document.getElementById('home-view');


/**
 * Aggressively stops all active media streams and resets global states.
 */
function stopActiveStreams() {
    // Only stop the screen stream, as mic/cam streams are no longer requested
    const streams = [screenStreamGlobal]; 
    streams.forEach(stream => {
        if (stream) stream.getTracks().forEach(t => t.stop());
    });
    
    screenStreamGlobal = null;
    micStreamGlobal = null; // Stays null/ignored

    if (audioContext) {
        audioContext.close().catch(e => console.error("AudioContext close error:", e));
    }
    audioContext = null;
}

/**
 * Prompts user for screen sharing and starts the recording process.
 * @param {object} settings - The recording configuration.
 */
async function startRecordingProcess(settings) {
    try {
        // --- HARDCODE SETTINGS TO DISABLE MIC AND CAM ---
        // This overrides any old or missing values from the HTML settings object
        settings.mic = 'none'; // Ensure no mic is used
        settings.cam = 'off'; // Ensure no cam is requested
        // ----------------------------------------------
        
        // 0. PRE-FLIGHT CHECK
        stopActiveStreams();
        currentBlob = null; 
        window.currentBlob = null; 

        // Show loading state
        // (Assuming you have a way to show a loading message in your UI if needed)
        
        // 1. Get Screen Stream (Only screen video and system audio is possible now)
        const screenConstraints = {
            video: { height: settings.quality, frameRate: 30 },
            audio: true // Request system audio if possible
        };
        
        // Request the screen/window capture
        screenStreamGlobal = await navigator.mediaDevices.getDisplayMedia(screenConstraints);
        
        const videoTracks = screenStreamGlobal.getVideoTracks();
        if (videoTracks.length === 0 || !videoTracks[0].enabled || videoTracks[0].readyState === 'ended') {
            throw new Error("Screen sharing cancelled or video track not available.");
        }
        const screenVideoTrack = videoTracks[0];

        // 2. AWAIT VIDEO TRACK READINESS
        livePreview.srcObject = screenStreamGlobal;
        
        await new Promise((resolve, reject) => {
            let resolved = false;
            
            const checkReady = () => {
                if (livePreview.readyState >= 2 && !resolved) { 
                    livePreview.removeEventListener('loadeddata', checkReady);
                    resolved = true;
                    resolve();
                }
            };
            
            livePreview.addEventListener('loadeddata', checkReady);
            
            setTimeout(() => {
                if (!resolved) {
                    // This error is less critical and usually means the stream started, but not fast enough for the event listener
                    console.warn("Video track loaded data event missed or delayed.");
                    resolve(); 
                }
            }, 5000); 

            screenVideoTrack.onended = () => reject(new Error("Screen sharing terminated by user/OS."));
        });
        
        // Stream is ready and active
        livePreview.style.display = 'block'; 

        // 3. Start MediaRecorder
        // The stream used here is just the screenStreamGlobal, which contains
        // the screen video and the (optional) system audio selected by the user.
        mediaRecorder = new MediaRecorder(screenStreamGlobal, { mimeType: 'video/webm; codecs=vp9' });
        recordedChunks = [];
        
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = finishRecording;
        
        mediaRecorder.start();
        startTimer();
        openControlPopup(settings); 
        
    } catch (err) {
        console.error("Recording Setup Failed:", err);
        stopActiveStreams(); 
        
        if (err.name === "NotAllowedError" || err.message.includes("cancelled") || err.message.includes("not available")) {
            alert("Recording cancelled: Please ensure you select a screen/window.");
        } else {
            alert("Error starting recording. Details: " + err.message);
        }
        
        resetToHome();
    }
}

/**
 * Stops the MediaRecorder and proceeds to finish recording.
 */
function stopRecordingProcess() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

/**
 * Handles the completion of the recording, cleans up, and shows the post-modal.
 */
function finishRecording() {
    clearInterval(timerInterval);
    closePopup();
    stopActiveStreams(); 

    livePreview.srcObject = null;
    livePreview.style.display = 'none';

    recordingInterface.style.display = 'none';
    postModal.style.display = 'flex';
    
    currentBlob = new Blob(recordedChunks, { type: 'video/webm' });
    window.currentBlob = currentBlob; 
    
    finalReviewVideo.src = URL.createObjectURL(currentBlob);
    
    if (currentBlob.size === 0) {
         alert("⚠️ Warning: The resulting video file is empty. Please try again or check browser permissions.");
    }

    finalReviewVideo.load();
}

/**
 * Resets the UI and state back to the home view.
 */
function resetToHome() {
    stopActiveStreams(); 
    
    postModal.style.display = 'none';
    recordingInterface.style.display = 'none';
    homeView.style.display = 'flex';
    seconds = 0;
    isPaused = false;
    timerDisplay.innerText = "00:00:00";
    document.getElementById('btnPause').innerText = "||";
    window.currentBlob = null; 
}

// ====================================================================
// TIMER AND POPUP CONTROL FUNCTIONS (Unchanged)
// ====================================================================

function startTimer() { 
    timerInterval = setInterval(() => {
        seconds++;
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        const t = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        timerDisplay.innerText = t;
        updatePopupTimer(t);
    }, 1000);
}

window.togglePause = function() { 
    if(!mediaRecorder) return;
    const btn = document.getElementById('btnPause');
    if(!isPaused) {
        if(mediaRecorder.state === 'recording') mediaRecorder.pause();
        clearInterval(timerInterval);
        btn.innerText = "▶";
        updatePopupPause("▶");
        isPaused = true;
    } else {
        if(mediaRecorder.state === 'paused') mediaRecorder.resume();
        startTimer();
        btn.innerText = "||";
        updatePopupPause("||");
        isPaused = false;
    }
}

function openControlPopup(settings) {
    if (controlPopup && !controlPopup.closed) { controlPopup.focus(); return; }
    
    // Fixed size as webcam is gone
    const w = 250; 
    const h = 150;
    const left = (screen.width - w) / 2;
    const top = 50; 
    
    controlPopup = window.open("", "ReKlugControls", `width=${w},height=${h},top=${top},left=${left},resizable=no`);
    
    if (!controlPopup) {
        document.getElementById('popup-warning').style.display = 'block';
        return;
    } else {
        document.getElementById('popup-warning').style.display = 'none';
    }

    // Inject the necessary HTML and JavaScript into the popup window
    controlPopup.document.write(`
        <html><body style="background:#0f0f0f;color:white;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;margin:0;">
            <div style="color:#00C6FF;font-size:12px;margin-bottom:5px;">● LIVE REC</div>
            <div id="popTimer" style="font-size:24px;font-weight:bold;margin-bottom:15px;font-family:monospace;">00:00:00</div>
            <div style="display:flex;gap:15px;">
                <button id="popPause" style="width:40px;height:40px;border-radius:50%;border:none;cursor:pointer;font-size:18px;background:#444;color:white;">||</button>
                <button id="popStop" style="width:40px;height:40px;border-radius:50%;border:none;cursor:pointer;font-size:18px;background:#ff3b3b;color:white;">⬛</button>
            </div>
            <script>
                document.getElementById('popPause').onclick = () => window.opener.togglePause();
                document.getElementById('popStop').onclick = () => window.opener.stopRecordingProcess();
                window.onunload = () => window.opener.stopRecordingProcess(); 
            <\/script>
        </body></html>
    `);
    
    controlPopup.focus();
}

function updatePopupTimer(t) { if(controlPopup && !controlPopup.closed) controlPopup.document.getElementById('popTimer').innerText = t; }
function updatePopupPause(s) { if(controlPopup && !controlPopup.closed) controlPopup.document.getElementById('popPause').innerText = s; }
function closePopup() { 
    if(controlPopup && !controlPopup.closed) controlPopup.close(); 
    controlPopup = null; 
}

// Expose core functions for use in index.html
window.startRecordingProcess = startRecordingProcess;
window.stopRecordingProcess = stopRecordingProcess;
window.resetToHome = resetToHome;
// ====================================================================