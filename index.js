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
    const languageSelect = document.getElementById('language-select');
    const uploadLanguageSelect = document.getElementById('upload-language-select');
    const uploadInput = document.getElementById('upload-input');
    const uploadDropzone = document.getElementById('upload-dropzone');
    const uploadTranscribeButton = document.getElementById('upload-transcribe-button');
    const uploadTranscriptionResult = document.getElementById('upload-transcription-result');
    const uploadCopyButton = document.getElementById('upload-copy-button');
    const uploadSaveButton = document.getElementById('upload-save-button');
    const uploadFileName = document.getElementById('upload-file-name');
    const uploadFileDuration = document.getElementById('upload-file-duration');
    const uploadFileSize = document.getElementById('upload-file-size');
    const uploadFileChunks = document.getElementById('upload-file-chunks');
    const uploadStepDecode = document.getElementById('upload-step-decode');
    const uploadStepSplit = document.getElementById('upload-step-split');
    const uploadStepTranscribe = document.getElementById('upload-step-transcribe');
    const uploadStepMerge = document.getElementById('upload-step-merge');
    const uploadProgressNote = document.querySelector('.upload-progress-note');

    const UPLOAD_CHUNK_SECONDS = 600;
    const UPLOAD_OVERLAP_SECONDS = 3;

    let isRecording = false;
    let mediaRecorder;
    let audioChunks = [];
    let timerInterval;
    let startTime;
    let uploadState = {
        file: null,
        audioBuffer: null,
        isTranscribing: false
    };

    function updateControlState() {
        const hasText = transcriptionResult.value.trim().length > 0;
        copyButton.disabled = !hasText;
        refineIcon.hidden    = !hasText;
    }
    // Update control state when updated manually
    transcriptionResult.addEventListener('input', updateControlState);

    const saveTranscriptionToLocalStorage = () => {
        const transcriptionText = transcriptionResult.value;
        localStorage.setItem('voice-note-transcription', transcriptionText);
    };
    
    const restoreTranscriptionFromLocalStorage = () => {
        const savedText = localStorage.getItem('voice-note-transcription');
        if (savedText) {
            transcriptionResult.value = savedText;
            autoResize.call(transcriptionResult);
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

    function updateUploadControlState() {
        if (!uploadTranscriptionResult || !uploadCopyButton || !uploadSaveButton) {
            return;
        }
        const hasText = uploadTranscriptionResult.value.trim().length > 0;
        uploadCopyButton.disabled = !hasText;
        uploadSaveButton.disabled = !hasText;
    }

    function setUploadStepState(element, state) {
        if (!element) {
            return;
        }
        element.classList.remove('is-pending', 'is-active', 'is-complete');
        if (state) {
            element.classList.add(`is-${state}`);
        }
    }

    function setUploadProgress(message) {
        if (uploadProgressNote) {
            uploadProgressNote.textContent = message;
        }
    }

    function resetUploadSteps() {
        setUploadStepState(uploadStepDecode, 'pending');
        setUploadStepState(uploadStepSplit, 'pending');
        setUploadStepState(uploadStepTranscribe, 'pending');
        setUploadStepState(uploadStepMerge, 'pending');
    }

    function resetUploadUI() {
        if (!uploadTranscriptionResult) {
            return;
        }
        uploadTranscriptionResult.value = '';
        updateUploadControlState();
        if (uploadTranscribeButton) {
            uploadTranscribeButton.disabled = !uploadState.audioBuffer || uploadState.isTranscribing;
        }
        if (uploadFileName) {
            uploadFileName.textContent = uploadState.file ? uploadState.file.name : 'No file selected';
        }
        if (uploadFileDuration) {
            uploadFileDuration.textContent = '--:--';
        }
        if (uploadFileSize) {
            uploadFileSize.textContent = uploadState.file ? formatBytes(uploadState.file.size) : '--';
        }
        if (uploadFileChunks) {
            uploadFileChunks.textContent = '--';
        }
        resetUploadSteps();
        setUploadProgress('Select an MP3 file to begin.');
    }

    function formatDuration(totalSeconds) {
        const rounded = Math.max(0, Math.floor(totalSeconds));
        const hours = Math.floor(rounded / 3600);
        const minutes = Math.floor((rounded % 3600) / 60);
        const seconds = rounded % 60;
        if (hours > 0) {
            return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) {
            return '0 B';
        }
        const units = ['B', 'KB', 'MB', 'GB'];
        const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        const value = bytes / (1024 ** index);
        return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
    }

    function calculateChunkCount(durationSeconds) {
        if (durationSeconds <= UPLOAD_CHUNK_SECONDS) {
            return 1;
        }
        const step = UPLOAD_CHUNK_SECONDS - UPLOAD_OVERLAP_SECONDS;
        return Math.ceil((durationSeconds - UPLOAD_OVERLAP_SECONDS) / step);
    }

    async function decodeAudioFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        try {
            return await audioContext.decodeAudioData(arrayBuffer);
        } finally {
            await audioContext.close();
        }
    }

    function splitAudioBuffer(audioBuffer, chunkSeconds, overlapSeconds) {
        if (audioBuffer.duration <= chunkSeconds) {
            return [audioBuffer];
        }
        const segments = [];
        const sampleRate = audioBuffer.sampleRate;
        const numChannels = audioBuffer.numberOfChannels;
        const stepSeconds = chunkSeconds - overlapSeconds;
        const slicingContext = new (window.AudioContext || window.webkitAudioContext)();
        let startSeconds = 0;

        while (startSeconds < audioBuffer.duration) {
            const endSeconds = Math.min(startSeconds + chunkSeconds, audioBuffer.duration);
            const startSample = Math.floor(startSeconds * sampleRate);
            const endSample = Math.floor(endSeconds * sampleRate);
            const frameCount = Math.max(0, endSample - startSample);

            const segmentBuffer = slicingContext.createBuffer(numChannels, frameCount, sampleRate);
            for (let channel = 0; channel < numChannels; channel += 1) {
                const channelData = audioBuffer.getChannelData(channel).subarray(startSample, endSample);
                segmentBuffer.copyToChannel(channelData, channel, 0);
            }

            segments.push(segmentBuffer);
            if (endSeconds >= audioBuffer.duration) {
                break;
            }
            startSeconds += stepSeconds;
        }

        slicingContext.close();
        return segments;
    }

    function writeString(view, offset, value) {
        for (let i = 0; i < value.length; i += 1) {
            view.setUint8(offset + i, value.charCodeAt(i));
        }
    }

    function audioBufferToWav(audioBuffer) {
        const numChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const bitsPerSample = 16;
        const bytesPerSample = bitsPerSample / 8;
        const blockAlign = numChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataLength = audioBuffer.length * blockAlign;
        const buffer = new ArrayBuffer(44 + dataLength);
        const view = new DataView(buffer);

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        writeString(view, 36, 'data');
        view.setUint32(40, dataLength, true);

        const channelData = [];
        for (let channel = 0; channel < numChannels; channel += 1) {
            channelData.push(audioBuffer.getChannelData(channel));
        }

        let offset = 44;
        for (let i = 0; i < audioBuffer.length; i += 1) {
            for (let channel = 0; channel < numChannels; channel += 1) {
                let sample = channelData[channel][i];
                sample = Math.max(-1, Math.min(1, sample));
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
                offset += 2;
            }
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    function requestTranscription(file, language) {
        const apiKey = localStorage.getItem('apiKey');
        const baseURL = localStorage.getItem('baseURL') || 'https://api.openai.com/v1/';
        const model = localStorage.getItem('model-select') || 'gpt-4o-mini-transcribe';

        if (!apiKey) {
            return Promise.reject(new Error('API key is missing.'));
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('model', model);
        if (language) {
            formData.append('language', language);
        }

        return fetch(`${baseURL}audio/transcriptions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
            body: formData
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
            if (data && data.text) {
                return data.text;
            }
            throw new Error('No text returned from API.');
        });
    }

    async function handleUploadFile(file) {
        if (!file) {
            return;
        }
        if (uploadState.isTranscribing) {
            UIkit.notification('Transcription is in progress. Please wait.', { status: 'warning' });
            return;
        }
        const isMp3 = file.type === 'audio/mpeg' || file.name.toLowerCase().endsWith('.mp3');
        if (!isMp3) {
            UIkit.notification('Only MP3 files are supported right now.', { status: 'warning' });
            return;
        }

        uploadState = {
            file: file,
            audioBuffer: null,
            isTranscribing: false
        };

        if (uploadDropzone) {
            uploadDropzone.classList.remove('is-dragover');
        }

        resetUploadUI();
        setUploadStepState(uploadStepDecode, 'active');
        setUploadProgress('Decoding audio...');

        try {
            const audioBuffer = await decodeAudioFile(file);
            uploadState.audioBuffer = audioBuffer;
            setUploadStepState(uploadStepDecode, 'complete');

            if (uploadFileDuration) {
                uploadFileDuration.textContent = formatDuration(audioBuffer.duration);
            }
            if (uploadFileChunks) {
                uploadFileChunks.textContent = `${calculateChunkCount(audioBuffer.duration)}`;
            }
            if (uploadFileName) {
                uploadFileName.textContent = file.name;
            }
            if (uploadFileSize) {
                uploadFileSize.textContent = formatBytes(file.size);
            }
            if (uploadTranscribeButton) {
                uploadTranscribeButton.disabled = false;
            }
            setUploadProgress('Ready to transcribe.');
        } catch (error) {
            console.error('Upload decode error:', error);
            UIkit.modal.alert('Failed to decode the audio file.');
            resetUploadUI();
        }
    }

    async function transcribeUploadAudio() {
        if (!uploadState.file || !uploadState.audioBuffer) {
            UIkit.notification('Please select an MP3 file first.', { status: 'warning' });
            return;
        }
        if (!localStorage.getItem('apiKey')) {
            UIkit.modal.alert('Please set your API key in the settings first.');
            return;
        }
        if (uploadState.isTranscribing) {
            return;
        }

        uploadState.isTranscribing = true;
        if (uploadTranscribeButton) {
            uploadTranscribeButton.disabled = true;
        }
        if (uploadDropzone) {
            uploadDropzone.classList.add('is-disabled');
        }
        if (uploadInput) {
            uploadInput.disabled = true;
        }

        uploadTranscriptionResult.value = '';
        updateUploadControlState();

        setUploadStepState(uploadStepSplit, 'active');
        setUploadProgress('Splitting into chunks...');

        try {
            const segments = splitAudioBuffer(uploadState.audioBuffer, UPLOAD_CHUNK_SECONDS, UPLOAD_OVERLAP_SECONDS);
            setUploadStepState(uploadStepSplit, 'complete');
            setUploadStepState(uploadStepTranscribe, 'active');

            const transcriptions = [];
            const selectedUploadLanguage = uploadLanguageSelect ? uploadLanguageSelect.value : languageSelect.value;
            for (let index = 0; index < segments.length; index += 1) {
                setUploadProgress(`Transcribing chunk ${index + 1} / ${segments.length}...`);
                const wavBlob = audioBufferToWav(segments[index]);
                const fileName = `upload-part-${String(index + 1).padStart(2, '0')}.wav`;
                const wavFile = new File([wavBlob], fileName, { type: 'audio/wav' });
                const text = await requestTranscription(wavFile, selectedUploadLanguage);
                transcriptions.push(text);
            }

            setUploadStepState(uploadStepTranscribe, 'complete');
            setUploadStepState(uploadStepMerge, 'active');
            setUploadProgress('Merging results...');

            uploadTranscriptionResult.value = transcriptions.filter(Boolean).join('\n\n');
            updateUploadControlState();

            setUploadStepState(uploadStepMerge, 'complete');
            setUploadProgress('Done.');
        } catch (error) {
            console.error('Upload transcription error:', error);
            UIkit.modal.alert(`Transcription failed: ${error.message}`);
            setUploadStepState(uploadStepTranscribe, 'pending');
            setUploadStepState(uploadStepMerge, 'pending');
            setUploadProgress('Transcription failed.');
        } finally {
            uploadState.isTranscribing = false;
            if (uploadTranscribeButton) {
                uploadTranscribeButton.disabled = !uploadState.audioBuffer;
            }
            if (uploadDropzone) {
                uploadDropzone.classList.remove('is-disabled');
            }
            if (uploadInput) {
                uploadInput.disabled = false;
            }
        }
    }

    function initUploadModule() {
        if (!uploadInput || !uploadDropzone || !uploadTranscriptionResult) {
            return;
        }

        resetUploadUI();

        uploadInput.addEventListener('change', (event) => {
            const file = event.target.files && event.target.files[0];
            handleUploadFile(file);
        });

        uploadDropzone.addEventListener('dragover', (event) => {
            event.preventDefault();
            uploadDropzone.classList.add('is-dragover');
        });

        uploadDropzone.addEventListener('dragleave', () => {
            uploadDropzone.classList.remove('is-dragover');
        });

        uploadDropzone.addEventListener('drop', (event) => {
            event.preventDefault();
            const file = event.dataTransfer.files && event.dataTransfer.files[0];
            handleUploadFile(file);
        });

        if (uploadTranscribeButton) {
            uploadTranscribeButton.addEventListener('click', () => {
                transcribeUploadAudio();
            });
        }

        if (uploadCopyButton) {
            uploadCopyButton.addEventListener('click', () => {
                const textToCopy = uploadTranscriptionResult.value;
                navigator.clipboard.writeText(textToCopy)
                    .then(() => {
                        UIkit.notification('Text has been copied to the clipboard.', { status: 'success' });
                    })
                    .catch(error => {
                        console.error('Clipboard copy error:', error);
                        alert('Failed to copy to clipboard.');
                    });
            });
        }
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
        transcribeAudio();
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

    function isIOS() {
        return /iP(hone|od|ad)/.test(navigator.userAgent);
    }

    function transcribeAudio() {
        recordButton.disabled = true;
        recordButton.textContent = TRANSCRIBING_LABEL;
        if (!localStorage.getItem('apiKey')) {
            UIkit.modal.alert('Please set your API key in the settings first.'); // Display error message using UIkit modal
            recordButton.disabled = false;
            recordButton.textContent = START_RECORDING_LABEL;
            return;
        }

        let selectedMimeType = 'audio/webm'; // Default MIME type
        let fileName = 'recording.webm';

        if (!isIOS() && MediaRecorder.isTypeSupported('audio/webm')) {
            selectedMimeType = 'audio/webm';
            fileName = 'recording.webm';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
            selectedMimeType = 'audio/mp4';
            fileName = 'recording.mp4';
        } else {
            UIkit.modal.alert('Unsupported audio format. Please use a supported browser.');
            recordButton.disabled = false;
            recordButton.textContent = START_RECORDING_LABEL;
            return;
        }

        const audioBlobWithType = new Blob(audioChunks, { type: selectedMimeType });
        const audioFile = new File([audioBlobWithType], fileName, { type: selectedMimeType });

        requestTranscription(audioFile, languageSelect.value)
            .then(text => {
                transcriptionResult.value += (transcriptionResult.value ? '\n\n' : '') + text;
                autoResize.call(transcriptionResult);
            })
            .catch(error => {
                console.error('Transcription fetch/processing error:', error); // Log error to console
                UIkit.modal.alert(`Transcription failed: ${error.message}`);
            })
            .finally(() => {
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

    const clearIcon = document.getElementById('clear-icon');
    clearIcon.addEventListener('click', () => {
        transcriptionResult.value = ''; // Clear transcription text
        localStorage.removeItem('voice-note-transcription'); // Also clear from localStorage
        timerDisplay.textContent = '00:00'; // Reset timer display
        autoResize.call(transcriptionResult); // Adjust height after clearing
        updateControlState(); // Update control state after clearing
    });
    
    refineIcon.addEventListener('click', refineTranscription);
    
    initUploadModule();

    // Initialize the notes module
    initNotesModule();
    
    // Initialize the AWS S3 sync module
    initAwsS3SyncModule();
});
