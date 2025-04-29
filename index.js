import { initNotesModule } from './notes.js';
import { initAwsS3SyncModule } from './aws-sync.js';

document.addEventListener('DOMContentLoaded', () => {
    const START_RECORDING_LABEL = 'Start Recording';
    const STOP_RECORDING_LABEL = 'Stop Recording';
    const TRANSCRIBING_LABEL = 'Transcribing...';

    const apiKeySettingMenuItem = document.querySelector('.uk-navbar-dropdown-nav a[id="openai-settings-link"]'); // "OpenAI API Settings" menu item
    const awsS3SettingMenuItem = document.querySelector('.uk-navbar-dropdown-nav a[id="aws-s3-settings-link"]'); // "AWS S3 Settings" menu item
    const recordButton = document.getElementById('record-button');
    const timerDisplay = document.getElementById('timer');
    const transcriptionResult = document.getElementById('transcription-result');
    const copyButton = document.getElementById('copy-button');
    const refineIcon = document.getElementById('refine-icon');
    const refineSpinner = document.getElementById('refine-spinner');
    const syncSpinner = document.getElementById('sync-spinner');
    const languageSelect = document.getElementById('language-select');

    let isRecording = false;
    let mediaRecorder;
    let audioChunks = [];
    let timerInterval;
    let startTime;

    function updateControlState() {
        const hasText = transcriptionResult.value.trim().length > 0;
        copyButton.disabled = !hasText;
        refineIcon.hidden    = !hasText;
    }
    // Update control state when updated manually
    transcriptionResult.addEventListener('input', updateControlState);

    const saveTranscriptionToLocalStorage = () => {
        const transcriptionText = document.getElementById('transcription-result').value;
        localStorage.setItem('voice-note-transcription', transcriptionText);
    };
    
    const restoreTranscriptionFromLocalStorage = () => {
        const savedText = localStorage.getItem('voice-note-transcription');
        if (savedText) {
            document.getElementById('transcription-result').value = savedText;
            updateControlState();
        }
    };
    
    restoreTranscriptionFromLocalStorage();
    
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

    // Create OpenAI settings modal element
    const apiKeySettingsModal = UIkit.modal(
        `<div id="settings-modal" uk-modal>
            <div class="uk-modal-dialog">
                <button class="uk-modal-close-default" type="button" uk-close></button>
                <div class="uk-modal-header">
                    <h2 class="uk-modal-title">OpenAI API Settings</h2>
                </div>
                <div class="uk-modal-body">
                    <iframe src="api-settings.html" width="100%" height="450px"></iframe>
                </div>
            </div>
        </div>`
    );
    
    // Create AWS S3 settings modal element
    const awsSettingsModal = UIkit.modal(
        `<div id="aws-settings-modal" uk-modal>
            <div class="uk-modal-dialog">
                <button class="uk-modal-close-default" type="button" uk-close></button>
                <div class="uk-modal-header">
                    <h2 class="uk-modal-title">AWS S3 Settings</h2>
                </div>
                <div class="uk-modal-body">
                    <iframe src="aws-settings.html" width="100%" height="500px"></iframe>
                </div>
            </div>
        </div>`
    );

    // Add event listener to "OpenAI API Settings" menu item
    apiKeySettingMenuItem.addEventListener('click', (e) => {
        e.preventDefault(); // Prevent default link behavior

        // Close the dropdown menu manually (for iOS Chrome) 
        const dropdown = document.querySelector('.uk-navbar-dropdown');
        if (dropdown) {
            UIkit.dropdown(dropdown).hide();
        }
        
        apiKeySettingsModal.show();
    });
    
    // Add event listener to "AWS S3 Settings" menu item
    awsS3SettingMenuItem.addEventListener('click', (e) => {
        e.preventDefault(); // Prevent default link behavior
        
        // Close the dropdown menu manually (for iOS Chrome) 
        const dropdown = document.querySelector('.uk-navbar-dropdown');
        if (dropdown) {
            UIkit.dropdown(dropdown).hide();
        }
        
        awsSettingsModal.show(); // Open AWS settings modal
    });

    // Resizing of transcription result area
    transcriptionResult.addEventListener('input', autoResize);

    function autoResize() {
        // Get the scrollHeight after resetting the height by auto
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
    }

    recordButton.addEventListener('click', () => {
        if (!isRecording) {
            startRecording();
        } else {
            stopRecording();
        }
    });

    function startRecording() {
        if (!localStorage.getItem('apiKey')) {
            UIkit.modal.alert('Please set your API key in the settings first.'); // Display error message using UIkit modal
            return;
        }

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
                transcriptionResult.value = 'Microphone access has not been granted.';
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
            transcriptionResult.value = 'Recording has automatically stopped because it exceeded 10 minutes.';
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
                transcriptionResult.value += (transcriptionResult.value ? '\n\n' : '') + data.text;
                autoResize.call(transcriptionResult)
            } else {
                console.warn('Transcription API returned success but no text:', data);
                UIkit.modal.alert('Transcription failed: No text returned from API.'); // Display error message using UIkit modal
            }
            recordButton.disabled = false;
            recordButton.textContent = START_RECORDING_LABEL;
            updateControlState(); // Update control state after transcription
        })
        .catch(error => {
            console.error('Transcription fetch/processing error:', error); // Log error to console
            // Display error message using UIkit modal
            UIkit.modal.alert(`Transcription failed: ${error.message}`);
            recordButton.disabled = false;
            recordButton.textContent = START_RECORDING_LABEL;
            updateControlState(); // Update control state after transcription
        });
    }

    copyButton.addEventListener('click', () => {
        const textToCopy = transcriptionResult.value;
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
        const transcriptionText = transcriptionResult.value;
        if (!transcriptionText) {
            UIkit.notification('No text to refine.', { status: 'warning' });
            return;
        }

        // Hide refine icon and show spinner during refinement
        refineIcon.hidden = true;
        refineSpinner.hidden = false;
        
        const apiKey = localStorage.getItem('apiKey');
        const baseURL = localStorage.getItem('baseURL') || 'https://api.openai.com/v1/';
        const modelName = "gpt-4o-mini"; // Use the specified model
        
        if (!apiKey) {
            UIkit.modal.alert('Please set your API key in the settings first.');
            // Hide spinner and show refine icon
            refineSpinner.hidden = true;
            refineIcon.hidden = false;
            return;
        }
        
        if (!prompts) {
            UIkit.modal.alert('Unable to load prompts. Please refresh the page and try again.');
            // Hide spinner and show refine icon
            refineSpinner.hidden = true;
            refineIcon.hidden = false;
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
                transcriptionResult.value = responseContent.refined_text;
                autoResize.call(transcriptionResult)
                // UIkit.notification('Text has been refined.', { status: 'success' });
            } catch (error) {
                console.error('Error parsing API response:', error);
                UIkit.modal.alert('Failed to parse the refined text.');
            }
            // Hide spinner and show refine icon after refinement
            refineSpinner.hidden = true;
            refineIcon.hidden = false;
        })
        .catch(error => {
            console.error('Refinement fetch/processing error:', error);
            UIkit.modal.alert(`Refinement failed: ${error.message}`);
            // Hide spinner and show refine icon after refinement error
            refineSpinner.hidden = true;
            refineIcon.hidden = false;
        });
    }

    const clearButton = document.getElementById('clear-button');
    clearButton.addEventListener('click', () => {
        transcriptionResult.value = ''; // Clear transcription text
        localStorage.removeItem('voice-note-transcription'); // Also clear from localStorage
        timerDisplay.textContent = '00:00'; // Reset timer display
        autoResize.call(transcriptionResult); // Adjust height after clearing
        updateControlState(); // Update control state after clearing
    });
    
    refineIcon.addEventListener('click', refineTranscription);
    
    // Initialize the notes module
    initNotesModule();
    
    // Initialize the AWS S3 sync module
    initAwsS3SyncModule();
});
