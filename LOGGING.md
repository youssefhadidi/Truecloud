<!-- @format -->

# Server Logging Documentation

## Overview

Comprehensive logging has been added to the Truecloud Next.js server to help debug crashes and monitor server behavior.

## Logger Features

### Location

- **Logger utility**: `lib/logger.js`

### Log Levels

- **ERROR** (Red): Critical errors and exceptions
- **WARN** (Yellow): Warnings and suspicious activity
- **INFO** (Cyan): General information about operations
- **DEBUG** (Gray): Detailed debugging information

### Automatic Features

1. **Colored Console Output**: Different colors for each log level
2. **Timestamps**: ISO format timestamps on all logs
3. **Structured Data**: JSON formatting for complex objects
4. **Error Stack Traces**: Automatic stack trace logging for errors
5. **Global Error Handlers**:
   - Uncaught exceptions
   - Unhandled promise rejections
   - Node.js warnings

## What's Being Logged

### File Operations (`/api/files`)

- ✅ File listing requests
- ✅ Access control (unauthorized, access denied)
- ✅ Directory traversal attempts
- ✅ File counts and request duration
- ✅ Delete operations (files and directories)
- ✅ Rename operations
- ✅ All errors with full context

### Upload Operations (`/api/files/upload`)

- ✅ Upload initiation
- ✅ File details (name, size, type)
- ✅ Directory creation
- ✅ Upload success/failure
- ✅ Request duration
- ✅ Detailed error messages

### Thumbnail Generation (`/api/files/thumbnail/[id]`)

- ✅ Thumbnail requests
- ✅ Cache hits (304 responses)
- ✅ Semaphore status (concurrent generation limit)
- ✅ FFmpeg process execution
- ✅ Generation duration
- ✅ Errors and timeouts
- ✅ Memory usage patterns

### Folder Creation (`/api/files/mkdir`)

- ✅ Folder creation requests
- ✅ Security violations
- ✅ Success/failure status
- ✅ Request duration

## Log Examples

### Successful Operation

```
[2026-01-20T12:34:56.789Z] [INFO] POST /api/files/upload - File uploaded successfully
Data: {
  "fileName": "photo.jpg",
  "fileSize": 1048576,
  "path": "",
  "duration": "245ms"
}
```

### Error with Stack Trace

```
[2026-01-20T12:34:56.789Z] [ERROR] POST /api/files/upload - Upload failed
Error Stack: Error: ENOSPC: no space left on device
    at WriteStream.write (fs.js:...)
    ...
```

### Security Warning

```
[2026-01-20T12:34:56.789Z] [WARN] GET /api/files - Access denied to private folder
Data: {
  "requestedPath": "user_abc123/private",
  "userId": "xyz789",
  "userEmail": "user@example.com",
  "folderOwnerId": "abc123"
}
```

## Monitoring for Crashes

### Common Crash Indicators

1. **Memory Issues**
   - Look for: Multiple concurrent thumbnail generations
   - Semaphore logging shows queue depth
   - FFmpeg timeout errors

2. **File System Errors**
   - ENOSPC (no space left)
   - EACCES (permission denied)
   - EMFILE (too many open files)

3. **Uncaught Errors**
   - Check for "Uncaught Exception" logs
   - "Unhandled Promise Rejection" logs

### Using the Logs

1. **Real-time Monitoring**

   ```bash
   pnpm start | tee server.log
   ```

2. **Search for Errors**

   ```bash
   grep "ERROR" server.log
   ```

3. **Find Slow Requests**

   ```bash
   grep "duration.*[5-9][0-9][0-9]ms" server.log
   ```

4. **Track Specific File**
   ```bash
   grep "filename.jpg" server.log
   ```

## Performance Tracking

Each API route logs:

- Request start time
- Operation duration in milliseconds
- File sizes and counts
- Concurrent operation counts (thumbnails)

This helps identify:

- Slow operations
- Memory bottlenecks
- Concurrency issues

## Next.js Configuration

Updated `next.config.js` with:

- Detailed fetch logging
- Configuration startup logs
- Environment information

## Tips for Debugging Crashes

1. **Before crash**: Look for patterns in ERROR/WARN logs
2. **Memory issues**: Check semaphore queue depth for thumbnails
3. **Startup issues**: Check configuration logs
4. **Timeout issues**: Look for FFmpeg timeout messages
5. **File system**: Check for ENOSPC, EACCES errors

## Reducing Log Verbosity

To reduce DEBUG logs in production, you can modify `lib/logger.js`:

```javascript
// Only log INFO, WARN, ERROR in production
const isProduction = process.env.NODE_ENV === 'production';

debug: (message, data) => {
  if (!isProduction) {
    log(LOG_LEVELS.DEBUG, message, data);
  }
},
```

## Future Improvements

- [ ] Add log rotation for large log files
- [ ] Integrate with external logging service (e.g., Winston, Pino)
- [ ] Add performance metrics aggregation
- [ ] Create log analysis scripts
