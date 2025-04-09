document.addEventListener('DOMContentLoaded', () => {
    const mainArea = document.getElementById('main-area');
    const apiKeySettingMenuItem = document.querySelector('.uk-navbar-dropdown-nav a[href="#"]'); // "API Key Settings" menu item

    // Function to open settings modal
    const openSettingsModal = () => {
        settingsModal.show();
    };
    
    const saveTranscriptionToLocalStorage = () => {
        const transcriptionText = document.getElementById('transcription-result').textContent;
        localStorage.setItem('voice-note-transcription', transcriptionText);
    };
    
    const restoreTranscriptionFromLocalStorage = () => {
        const savedText = localStorage.getItem('voice-note-transcription');
        if (savedText) {
            document.getElementById('transcription-result').textContent = savedText;
        }
    };
    
    restoreTranscriptionFromLocalStorage();
    
    const checkAndEnableRefineButton = () => {
        if (document.getElementById('refine-button') && document.getElementById('transcription-result')) {
            const text = document.getElementById('transcription-result').textContent.trim();
            document.getElementById('refine-button').disabled = !text;
        }
    };
    
    setTimeout(checkAndEnableRefineButton, 100);
    
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            saveTranscriptionToLocalStorage();
        }
    });
    
    window.addEventListener('pagehide', saveTranscriptionToLocalStorage);
    window.addEventListener('beforeunload', saveTranscriptionToLocalStorage);

    let prompts = null;
    fetch('prompts.json')
        .then(response => response.json())
        .then(data => {
            prompts = data;
        })
        .catch(error => console.error('Error loading prompts:', error));

    // Create modal element
    const settingsModal = UIkit.modal(
        `<div id="settings-modal" uk-modal>
            <div class="uk-modal-dialog">
                <button class="uk-modal-close-default" type="button" uk-close></button>
                <div class="uk-modal-header">
                    <h2 class="uk-modal-title">OpenAI API Settings</h2>
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

    const START_RECORDING_LABEL = 'Start Recording';
    const STOP_RECORDING_LABEL = 'Stop Recording';
    const TRANSCRIBING_LABEL = 'Transcribing...';
    const REFINING_LABEL = 'Refining...';

    const recordButton = document.getElementById('record-button');
    const timerDisplay = document.getElementById('timer');
    const transcriptionResult = document.getElementById('transcription-result');
    const copyButton = document.getElementById('copy-button');
    const refineButton = document.getElementById('refine-button');
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
                recordButton.textContent = STOP_RECORDING_LABEL;
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
        recordButton.textContent = START_RECORDING_LABEL;
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
        recordButton.disabled = true;
        recordButton.textContent = TRANSCRIBING_LABEL;

        const apiKey = localStorage.getItem('apiKey');
        const baseURL = localStorage.getItem('baseURL') || 'https://api.openai.com/v1/';
        const model = localStorage.getItem('model-select') || 'gpt-4o-mini-transcribe';

        if (!apiKey) {
            UIkit.modal.alert('Please set your API key in the settings first.'); // Display error message using UIkit modal
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
        formData.append('model', model);
        formData.append('language', languageSelect.value);

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
            recordButton.disabled = false;
            recordButton.textContent = START_RECORDING_LABEL;
            copyButton.disabled = false; // Enable copy button when transcription is successful
            refineButton.disabled = false; // Enable refine button when transcription is successful
        })
        .catch(error => {
            console.error('Transcription fetch/processing error:', error); // Log error to console
            // Display error message using UIkit modal
            UIkit.modal.alert(`Transcription failed: ${error.message}`);
            recordButton.disabled = false;
            recordButton.textContent = START_RECORDING_LABEL;
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
    
    function refineTranscription() {
        const transcriptionText = transcriptionResult.textContent;
        if (!transcriptionText) {
            UIkit.notification('No text to refine.', { status: 'warning' });
            return;
        }

        refineButton.disabled = true;
        refineButton.textContent = REFINING_LABEL;
        
        const apiKey = localStorage.getItem('apiKey');
        const baseURL = localStorage.getItem('baseURL') || 'https://api.openai.com/v1/';
        const modelName = "gpt-4o-mini"; // Use the specified model
        
        if (!apiKey) {
            UIkit.modal.alert('Please set your API key in the settings first.');
            refineButton.disabled = false;
            refineButton.textContent = 'Refine';
            return;
        }
        
        if (!prompts) {
            UIkit.modal.alert('Unable to load prompts. Please refresh the page and try again.');
            refineButton.disabled = false;
            refineButton.textContent = 'Refine';
            return;
        }
        
        const language = languageSelect.value === 'ja' ? 'Japanese' : 'English';
        const promptTemplate = prompts.default[language].prompt;
        const promptContent = promptTemplate.replace('{input_text}', transcriptionText);
        
        fetch(`${baseURL}chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: modelName,
                messages: [{ role: "user", content: promptContent }],
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "refined_transcription",
                        strict: true,
                        schema: {
                            type: "object",
                            properties: {
                                refined_text: { type: "string" }
                            },
                            required: ["refined_text"],
                            additionalProperties: false
                        }
                    }
                }
            })
        })
        .then(response => {
            if (!response.ok) {
                return response.text().then(text => {
                    let detail = text;
                    try {
                        const errorJson = JSON.parse(text);
                        if (errorJson.error && errorJson.error.message) {
                            detail = errorJson.error.message;
                        }
                    } catch (e) {
                        // Ignore JSON parse error, use the raw text
                    }
                    throw new Error(`API Error: ${response.status} ${response.statusText} - ${detail}`);
                });
            }
            return response.json();
        })
        .then(data => {
            try {
                const responseContent = JSON.parse(data.choices[0].message.content);
                if (!responseContent || !responseContent.refined_text) {
                    throw new Error('Invalid response format from API.');
                }
                transcriptionResult.textContent = responseContent.refined_text;
                // UIkit.notification('Text has been refined.', { status: 'success' });
            } catch (error) {
                console.error('Error parsing API response:', error);
                UIkit.modal.alert('Failed to parse the refined text.');
            }
            refineButton.disabled = false;
            refineButton.textContent = 'Refine';
        })
        .catch(error => {
            console.error('Refinement fetch/processing error:', error);
            UIkit.modal.alert(`Refinement failed: ${error.message}`);
            refineButton.disabled = false;
            refineButton.textContent = 'Refine';
        });
    }

    const clearButton = document.getElementById('clear-button');
    clearButton.addEventListener('click', () => {
        transcriptionResult.textContent = ''; // Clear transcription text
        localStorage.removeItem('voice-note-transcription'); // Also clear from localStorage
    });
    
    refineButton.addEventListener('click', refineTranscription);
});
