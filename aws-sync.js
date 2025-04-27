/**
 * AWS S3 Synchronization Module
 * This module handles synchronization of notes between local storage and AWS S3
 */

/**
 * Initialize the AWS S3 sync module
 * @returns {Object} The sync module API
 */
export function initAwsS3SyncModule() {
    const syncIcon = document.getElementById('sync-icon');
    const syncSpinner = document.getElementById('sync-spinner');
    
    syncIcon.addEventListener('click', () => {
        syncWithS3();
    });
    
    /**
     * Configure AWS SDK with credentials from localStorage
     * @returns {AWS.S3|null} Configured S3 client or null if settings are missing
     */
    const configureAWS = () => {
        const accessKeyId = localStorage.getItem('aws-access-key-id');
        const secretAccessKey = localStorage.getItem('aws-secret-access-key');
        const region = localStorage.getItem('aws-region');
        const bucketName = localStorage.getItem('s3-bucket-name');
        
        if (!accessKeyId || !secretAccessKey || !region || !bucketName) {
            return null;
        }
        
        AWS.config.update({
            accessKeyId: accessKeyId,
            secretAccessKey: secretAccessKey,
            region: region
        });
        
        return new AWS.S3({
            params: { Bucket: bucketName }
        });
    };
    
    /**
     * Synchronize notes with S3
     * This performs a two-way sync: first download from S3, then upload to S3
     */
    const syncWithS3 = () => {
        syncIcon.hidden = true;
        syncSpinner.hidden = false;
        
        const s3 = configureAWS();
        if (!s3) {
            UIkit.modal.alert('Please configure AWS S3 settings first.');
            syncIcon.hidden = false;
            syncSpinner.hidden = true;
            return;
        }
        
        downloadFromS3(s3)
            .then(() => uploadToS3(s3))
            .finally(() => {
                syncIcon.hidden = false;
                syncSpinner.hidden = true;
            });
    };
    
    /**
     * Download notes from S3
     * @param {AWS.S3} s3 - Configured S3 client
     * @returns {Promise} Promise that resolves when download is complete
     */
    const downloadFromS3 = (s3) => {
        return new Promise((resolve, reject) => {
            const bucketName = localStorage.getItem('s3-bucket-name');
            const params = {
                Bucket: bucketName,
                Key: 'voice-notes.json'
            };
            
            s3.getObject(params, (err, data) => {
                if (err) {
                    if (err.code === 'NoSuchKey') {
                        UIkit.notification('No notes found on S3.', { status: 'warning' });
                        resolve(); // Continue with upload
                    } else {
                        console.error('Error downloading from S3:', err);
                        UIkit.notification(`S3 download failed: ${err.message}`, { status: 'danger' });
                        reject(err);
                    }
                } else {
                    try {
                        const s3Notes = JSON.parse(data.Body.toString());
                        const localNoteList = JSON.parse(localStorage.getItem('noteList') || '[]');
                        
                        const mergedNotes = mergeNotes(localNoteList, s3Notes);
                        localStorage.setItem('noteList', JSON.stringify(mergedNotes));
                        
                        const downloadPromises = [];
                        for (const note of s3Notes) {
                            if (!localStorage.getItem(note.filePath)) {
                                downloadPromises.push(downloadNoteContent(s3, note.filePath));
                            }
                        }
                        
                        Promise.all(downloadPromises)
                            .then(() => {
                                UIkit.notification('Notes synchronized from S3.', { status: 'success' });
                                document.dispatchEvent(new CustomEvent('notes-updated'));
                                resolve();
                            })
                            .catch(error => {
                                console.error('Error downloading note contents:', error);
                                reject(error);
                            });
                    } catch (e) {
                        console.error('Error parsing S3 data:', e);
                        UIkit.notification(`Error parsing S3 data: ${e.message}`, { status: 'danger' });
                        reject(e);
                    }
                }
            });
        });
    };
    
    /**
     * Download individual note content from S3
     * @param {AWS.S3} s3 - Configured S3 client
     * @param {string} filePath - Note file path
     * @returns {Promise} Promise that resolves when download is complete
     */
    const downloadNoteContent = (s3, filePath) => {
        return new Promise((resolve, reject) => {
            const bucketName = localStorage.getItem('s3-bucket-name');
            const params = {
                Bucket: bucketName,
                Key: filePath
            };
            
            s3.getObject(params, (err, data) => {
                if (err) {
                    console.error(`Error downloading note content for ${filePath}:`, err);
                    reject(err);
                } else {
                    localStorage.setItem(filePath, data.Body.toString());
                    resolve();
                }
            });
        });
    };
    
    /**
     * Upload notes to S3
     * @param {AWS.S3} s3 - Configured S3 client
     * @returns {Promise} Promise that resolves when upload is complete
     */
    const uploadToS3 = (s3) => {
        return new Promise((resolve, reject) => {
            const notes = JSON.parse(localStorage.getItem('noteList') || '[]');
            if (notes.length === 0) {
                UIkit.notification('No notes to upload.', { status: 'warning' });
                resolve();
                return;
            }
            
            const bucketName = localStorage.getItem('s3-bucket-name');
            
            const listParams = {
                Bucket: bucketName,
                Key: 'voice-notes.json',
                Body: JSON.stringify(notes),
                ContentType: 'application/json'
            };
            
            s3.putObject(listParams, (err, data) => {
                if (err) {
                    console.error('Error uploading note list to S3:', err);
                    UIkit.notification(`S3 upload failed: ${err.message}`, { status: 'danger' });
                    reject(err);
                    return;
                }
                
                const uploadPromises = [];
                for (const note of notes) {
                    const content = localStorage.getItem(note.filePath);
                    if (content) {
                        uploadPromises.push(uploadNoteContent(s3, note.filePath, content));
                    }
                }
                
                Promise.all(uploadPromises)
                    .then(() => {
                        UIkit.notification('Notes synchronized to S3.', { status: 'success' });
                        resolve();
                    })
                    .catch(error => {
                        console.error('Error uploading note contents:', error);
                        reject(error);
                    });
            });
        });
    };
    
    /**
     * Upload individual note content to S3
     * @param {AWS.S3} s3 - Configured S3 client
     * @param {string} filePath - Note file path
     * @param {string} content - Note content
     * @returns {Promise} Promise that resolves when upload is complete
     */
    const uploadNoteContent = (s3, filePath, content) => {
        return new Promise((resolve, reject) => {
            const bucketName = localStorage.getItem('s3-bucket-name');
            const params = {
                Bucket: bucketName,
                Key: filePath,
                Body: content,
                ContentType: 'text/plain'
            };
            
            s3.putObject(params, (err, data) => {
                if (err) {
                    console.error(`Error uploading note content for ${filePath}:`, err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    };
    
    /**
     * Merge notes from S3 and local storage
     * @param {Array} localNotes - Notes from local storage
     * @param {Array} s3Notes - Notes from S3
     * @returns {Array} Merged notes
     */
    const mergeNotes = (localNotes, s3Notes) => {
        const notesMap = new Map();
        
        localNotes.forEach(note => {
            notesMap.set(note.id, note);
        });
        
        s3Notes.forEach(s3Note => {
            if (!notesMap.has(s3Note.id) || 
                new Date(s3Note.updatedAt) > new Date(notesMap.get(s3Note.id).updatedAt)) {
                notesMap.set(s3Note.id, s3Note);
            }
        });
        
        return Array.from(notesMap.values())
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    };
    
    return {
        syncWithS3
    };
}
