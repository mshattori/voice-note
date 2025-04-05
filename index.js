document.addEventListener('DOMContentLoaded', () => {
    const mainArea = document.getElementById('main-area');
    const apiKeySettingMenuItem = document.querySelector('.uk-navbar-dropdown-nav a[href="#"]'); // "API Key Settings" menu item

    // Function to open settings modal
    const openSettingsModal = () => {
        settingsModal.show();
    };

    // Create modal element
    const settingsModal = UIkit.modal(
        `<div id="settings-modal" uk-modal>
            <div class="uk-modal-dialog">
                <button class="uk-modal-close-default" type="button" uk-close></button>
                <div class="uk-modal-header">
                    <h2 class="uk-modal-title">API Key Settings</h2>
                </div>
                <div class="uk-modal-body">
                    <iframe src="settings.html" width="100%" height="300px"></iframe>
                </div>
            </div>
        </div>`
    );

    // Add event listener to "API Key Settings" menu item
    apiKeySettingMenuItem.addEventListener('click', (e) => {
        e.preventDefault(); // Prevent default link behavior
        openSettingsModal(); // Open settings modal
    });

    const recordButton = document.getElementById('record-button');
    const timerDisplay = document.getElementById('timer');
    const transcriptionResult = document.getElementById('transcription-result');
    const copyButton = document.getElementById('copy-button');
    const languageSelect = document.getElementById('language-select');

    let isRecording = false;
    let mediaRecorder;
    let audioChunks = [];
    let timerInterval;
    let startTime;

    recordButton.addEventListener('click', () => {
        if (!isRecording) {
            startRecording();
        } else {
            stopRecording();
        }
    });

    function startRecording() {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                mediaRecorder = new MediaRecorder(stream);
                mediaRecorder.ondataavailable = handleDataAvailable;
                mediaRecorder.onstop = handleStop;
                mediaRecorder.start();

                isRecording = true;
                recordButton.textContent = 'Stop Recording';
                timerDisplay.textContent = '00:00';
                startTimer();
                audioChunks = []; // clear previous recording
                copyButton.disabled = true; // disable copy button
            })
            .catch(error => {
                console.error('Microphone access permission error:', error);
                transcriptionResult.textContent = 'Microphone access has not been granted.';
            });
    }

    function handleDataAvailable(event) {
        if (event.data.size > 0) {
            audioChunks.push(event.data);
        }
    }

    function handleStop() {
        isRecording = false;
        recordButton.textContent = 'Start Recording';
        stopTimer();
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        transcribeAudio(audioBlob);
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop()); // stop microphone access
        }
    }

    function startTimer() {
        startTime = Date.now();
        timerInterval = setInterval(updateTimer, 1000); // update every second
    }

    function stopTimer() {
        clearInterval(timerInterval);
    }

    function updateTimer() {
        const elapsedTime = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(elapsedTime / 60);
        const seconds = elapsedTime % 60;
        const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        timerDisplay.textContent = formattedTime;

        if (elapsedTime >= 600) { // 10 minutes limit
            stopRecording();
            transcriptionResult.textContent = 'Recording has automatically stopped because it exceeded 10 minutes.';
        }
    }

    function transcribeAudio(audioBlob) {
    const apiKey = localStorage.getItem('apiKey');
    const baseURL = localStorage.getItem('baseURL') || 'https://api.openai.com/v1/';

    if (!apiKey) {
        transcriptionResult.textContent = 'API key is not set.';
        apiKeyConfig.style.display = 'block'; // Show API key configuration area
        mainArea.style.display = 'none'; // Hide main area
        return;
    }

    const formData = new FormData();
    let selectedMimeType = 'audio/webm'; // Default MIME type
    let fileName = 'recording.webm';

    if (MediaRecorder.isTypeSupported('audio/webm')) {
        selectedMimeType = 'audio/webm';
        fileName = 'recording.webm';
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        selectedMimeType = 'audio/mp4';
        fileName = 'recording.mp4';
    } else {
        UiKit.modal.alert('Unsupported audio format. Please use a supported browser.');
        return;
    }

    const audioBlobWithType = new Blob(audioChunks, { type: selectedMimeType });
    formData.append('file', new File([audioBlobWithType], fileName, { type: selectedMimeType }));
    formData.append('model', 'gpt-4o-mini-transcribe');
    formData.append('language', languageSelect.value); // Specify language

    fetch(`${baseURL}audio/transcriptions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        },
        body: formData
    })
    .then(response => {
        // Check if the response status is OK (200-299)
        if (!response.ok) {
            // If not OK, read the response body as text
            return response.text().then(text => {
                // Try to parse the text as JSON to get a detailed error message from the API
                let detail = text;
                try {
                    const errorJson = JSON.parse(text);
                    if (errorJson.error && errorJson.error.message) {
                        detail = errorJson.error.message;
                    }
                } catch (e) {
                    // Ignore JSON parse error, use the raw text
                }
                // Throw an error to be caught by the .catch block
                throw new Error(`API Error: ${response.status} ${response.statusText} - ${detail}`);
            });
        }
        // If response is OK, parse it as JSON
        return response.json();
    })
    .then(data => {
        // Check if data and data.text exist
        if (data && data.text) {
            transcriptionResult.textContent += (transcriptionResult.textContent ? '\n\n' : '') + data.text;
        } else {
            console.warn('Transcription API returned success but no text:', data);
            UIkit.modal.alert('Transcription failed: No text returned from API.'); // Display error message using UIkit modal
        }
        copyButton.disabled = false; // Enable copy button when transcription is successful
    })
    .catch(error => {
        console.error('Transcription fetch/processing error:', error); // Log error to console
        // Display error message using UIkit modal
        UIkit.modal.alert(`Transcription failed: ${error.message}`);
        copyButton.disabled = true; // Disable copy button
    });
}

    copyButton.addEventListener('click', () => {
        const textToCopy = transcriptionResult.textContent;
        navigator.clipboard.writeText(textToCopy)
            .then(() => {
                UIkit.notification('Text has been copied to the clipboard.', { status: 'success' }); // Notify successful clipboard copy using UIkit
            })
            .catch(error => {
                console.error('Clipboard copy error:', error);
                alert('Failed to copy to clipboard.'); // Notify clipboard copy failure
            });
    });

    const clearButton = document.getElementById('clear-button');
    clearButton.addEventListener('click', () => {
        transcriptionResult.textContent = ''; // Clear transcription text
    });
});
