/**
 * AWS S3 Synchronization Module
 * This module handles synchronization of notes between local storage and AWS S3
 */

/**
 * Initialize the AWS S3 sync module
 * @returns {Object} The sync module API
 */
export function initAwsS3SyncModule() {
    const syncSpinner = document.getElementById('sync-spinner');
    
    let deletedNotes = JSON.parse(localStorage.getItem('aws-deleted-notes') || '[]');
    
    let lastSyncTime = localStorage.getItem('aws-last-sync-time') || null;
    
    window.addEventListener('storage', (event) => {
        if (event.key === 'aws-access-key-id' || 
            event.key === 'aws-secret-access-key' || 
            event.key === 'aws-region' || 
            event.key === 'aws-s3-bucket-name') {
            
            const s3 = configureAWS();
            if (s3) {
                syncWithS3(true);
            }
        }
    });
    
    document.addEventListener('note-created', () => syncWithS3(false));
    document.addEventListener('note-updated', () => syncWithS3(false));
    document.addEventListener('note-deleted', (e) => {
        if (e.detail && e.detail.noteId) {
            addDeletedNote(e.detail.noteId);
        }
        syncWithS3(false);
    });
    
    UIkit.util.on('#main-tabs', 'shown', function(e) {
        if (e.target.textContent.trim() === 'Notes List') {
            syncWithS3(true);
        }
    });
    
    /**
     * Add a note ID to the deleted notes list
     * @param {string} noteId - The ID of the deleted note
     */
    const addDeletedNote = (noteId) => {
        deletedNotes.push({
            id: noteId,
            deletedAt: new Date().toISOString()
        });
        localStorage.setItem('aws-deleted-notes', JSON.stringify(deletedNotes));
    };
    
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
     * @param {boolean} showNotifications - Whether to show notifications
     */
    const syncWithS3 = (showNotifications = true) => {
        syncSpinner.hidden = false;
        
        const s3 = configureAWS();
        if (!s3) {
            syncSpinner.hidden = true;
            return;
        }
        
        downloadFromS3(s3, showNotifications)
            .then(() => uploadChangesToS3(s3, showNotifications))
            .finally(() => {
                syncSpinner.hidden = true;
                lastSyncTime = new Date().toISOString();
                localStorage.setItem('aws-last-sync-time', lastSyncTime);
            });
    };
    
    /**
     * Download notes from S3
     * @param {AWS.S3} s3 - Configured S3 client
     * @param {boolean} showNotifications - Whether to show notifications
     * @returns {Promise} Promise that resolves when download is complete
     */
    const downloadFromS3 = (s3, showNotifications) => {
        return new Promise((resolve, reject) => {
            const bucketName = localStorage.getItem('s3-bucket-name');
            const params = {
                Bucket: bucketName,
                Key: 'voice-notes.json'
            };
            
            s3.getObject(params, (err, data) => {
                if (err) {
                    if (err.code === 'NoSuchKey') {
                        if (showNotifications) {
                            UIkit.notification('No notes found on S3.', { status: 'warning' });
                        }
                        resolve(); // Continue with upload
                    } else {
                        console.error('Error downloading from S3:', err);
                        if (showNotifications) {
                            UIkit.notification(`S3 download failed: ${err.message}`, { status: 'danger' });
                        }
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
                            if (deletedNotes.some(deletedNote => deletedNote.id === note.id)) {
                                continue;
                            }
                            
                            if (!localStorage.getItem(note.filePath)) {
                                downloadPromises.push(downloadNoteContent(s3, note.filePath));
                            }
                        }
                        
                        Promise.all(downloadPromises)
                            .then(() => {
                                if (showNotifications && downloadPromises.length > 0) {
                                    UIkit.notification('Notes synchronized from S3.', { status: 'success' });
                                }
                                document.dispatchEvent(new CustomEvent('notes-updated'));
                                resolve();
                            })
                            .catch(error => {
                                console.error('Error downloading note contents:', error);
                                reject(error);
                            });
                    } catch (e) {
                        console.error('Error parsing S3 data:', e);
                        if (showNotifications) {
                            UIkit.notification(`Error parsing S3 data: ${e.message}`, { status: 'danger' });
                        }
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
     * Upload changed notes to S3
     * @param {AWS.S3} s3 - Configured S3 client
     * @param {boolean} showNotifications - Whether to show notifications
     * @returns {Promise} Promise that resolves when upload is complete
     */
    const uploadChangesToS3 = (s3, showNotifications) => {
        return new Promise((resolve, reject) => {
            const notes = JSON.parse(localStorage.getItem('noteList') || '[]');
            if (notes.length === 0 && deletedNotes.length === 0) {
                if (showNotifications) {
                    UIkit.notification('No notes to upload.', { status: 'warning' });
                }
                resolve();
                return;
            }
            
            const bucketName = localStorage.getItem('s3-bucket-name');
            
            const deletePromises = [];
            if (deletedNotes.length > 0) {
                for (const deletedNote of deletedNotes) {
                    deletePromises.push(deleteNoteFromS3(s3, deletedNote.id));
                }
            }
            
            Promise.all(deletePromises)
                .then(() => {
                    if (deletePromises.length > 0) {
                        deletedNotes = [];
                        localStorage.setItem('aws-deleted-notes', JSON.stringify(deletedNotes));
                    }
                    
                    const notesToUpload = lastSyncTime 
                        ? notes.filter(note => !lastSyncTime || new Date(note.updatedAt) > new Date(lastSyncTime))
                        : notes;
                    
                    if (notesToUpload.length === 0) {
                        const listParams = {
                            Bucket: bucketName,
                            Key: 'voice-notes.json',
                            Body: JSON.stringify(notes),
                            ContentType: 'application/json'
                        };
                        
                        s3.putObject(listParams, (err, data) => {
                            if (err) {
                                console.error('Error uploading note list to S3:', err);
                                if (showNotifications) {
                                    UIkit.notification(`S3 upload failed: ${err.message}`, { status: 'danger' });
                                }
                                reject(err);
                            } else {
                                resolve();
                            }
                        });
                        return;
                    }
                    
                    const listParams = {
                        Bucket: bucketName,
                        Key: 'voice-notes.json',
                        Body: JSON.stringify(notes),
                        ContentType: 'application/json'
                    };
                    
                    s3.putObject(listParams, (err, data) => {
                        if (err) {
                            console.error('Error uploading note list to S3:', err);
                            if (showNotifications) {
                                UIkit.notification(`S3 upload failed: ${err.message}`, { status: 'danger' });
                            }
                            reject(err);
                            return;
                        }
                        
                        const uploadPromises = [];
                        for (const note of notesToUpload) {
                            const content = localStorage.getItem(note.filePath);
                            if (content) {
                                uploadPromises.push(uploadNoteContent(s3, note.filePath, content));
                            }
                        }
                        
                        Promise.all(uploadPromises)
                            .then(() => {
                                if (showNotifications && (uploadPromises.length > 0 || deletePromises.length > 0)) {
                                    UIkit.notification('Notes synchronized to S3.', { status: 'success' });
                                }
                                resolve();
                            })
                            .catch(error => {
                                console.error('Error uploading note contents:', error);
                                reject(error);
                            });
                    });
                })
                .catch(error => {
                    console.error('Error deleting notes from S3:', error);
                    reject(error);
                });
        });
    };
    
    /**
     * Delete a note from S3
     * @param {AWS.S3} s3 - Configured S3 client
     * @param {string} noteId - The ID of the note to delete
     * @returns {Promise} Promise that resolves when deletion is complete
     */
    const deleteNoteFromS3 = (s3, noteId) => {
        return new Promise((resolve, reject) => {
            const bucketName = localStorage.getItem('s3-bucket-name');
            
            s3.getObject({
                Bucket: bucketName,
                Key: 'voice-notes.json'
            }, (err, data) => {
                if (err) {
                    if (err.code === 'NoSuchKey') {
                        resolve();
                    } else {
                        console.error('Error getting note list from S3:', err);
                        reject(err);
                    }
                    return;
                }
                
                try {
                    const s3Notes = JSON.parse(data.Body.toString());
                    const noteToDelete = s3Notes.find(note => note.id === noteId);
                    
                    if (!noteToDelete) {
                        resolve();
                        return;
                    }
                    
                    // Delete the note content
                    s3.deleteObject({
                        Bucket: bucketName,
                        Key: noteToDelete.filePath
                    }, (err, data) => {
                        if (err) {
                            console.error(`Error deleting note content for ${noteToDelete.filePath}:`, err);
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                } catch (e) {
                    console.error('Error parsing S3 note list:', e);
                    reject(e);
                }
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
            if (deletedNotes.some(deletedNote => deletedNote.id === s3Note.id)) {
                return;
            }
            
            if (!notesMap.has(s3Note.id) || 
                new Date(s3Note.updatedAt) > new Date(notesMap.get(s3Note.id).updatedAt)) {
                notesMap.set(s3Note.id, s3Note);
            }
        });
        
        return Array.from(notesMap.values())
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    };
    
    const s3 = configureAWS();
    if (s3) {
        setTimeout(() => syncWithS3(false), 1000);
    }
    
    return {
        syncWithS3
    };
}
