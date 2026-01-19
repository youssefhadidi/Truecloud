/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { spawn } from 'child_process';

// Helper function to generate thumbnails with FFmpeg
async function generateThumbnail(filePath, thumbnailPath, isVideo) {
  const ffmpegArgs = ['-y', '-i', filePath];

  if (isVideo) {
    ffmpegArgs.push('-ss', '00:00:01.000');
  }

  // Extract only the first frame
  ffmpegArgs.push('-frames:v', '1');

  // Optimize: smaller size, faster compression (JPG format)
  ffmpegArgs.push(
    '-vf',
    'scale=200:200:force_original_aspect_ratio=decrease',
    '-q:v',
    '12', // JPG quality (1-31, higher = faster/lower quality)
    thumbnailPath
  );

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    let errorOutput = '';
    let timedOut = false;

    // Set 10 second timeout
    const timeout = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill();
      reject(new Error('FFmpeg timeout after 10 seconds'));
    }, 10000);

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return;
      if (code === 0) {
        resolve();
      } else {
        console.error('FFmpeg failed with code:', code);
        console.error('FFmpeg error output:', errorOutput);
        reject(new Error(`FFmpeg exited with code ${code}: ${errorOutput}`));
      }
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timeout);
      if (timedOut) return;
      console.error('FFmpeg spawn error:', err);
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

// Helper function to generate PDF thumbnails
async function generatePdfThumbnail(filePath, thumbnailPath) {
  return new Promise((resolve, reject) => {
    // Use ImageMagick's magick command directly (requires Ghostscript for PDF support)
    const args = [
      '-density',
      '80', // Reduced from 150 for faster processing
      `${filePath}[0]`, // First page only - must come after density
      '-quality',
      '65', // Reduced from 80 for faster processing
      '-resize',
      '200x200',
      thumbnailPath,
    ];

    const magick = spawn('magick', args);
    let errorOutput = '';
    let timedOut = false;

    // Set 15 second timeout for PDF processing
    const timeout = setTimeout(() => {
      timedOut = true;
      magick.kill();
      reject(new Error('ImageMagick timeout after 15 seconds'));
    }, 15000);

    magick.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    magick.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return;
      if (code === 0) {
        resolve();
      } else {
        console.error('ImageMagick PDF failed with code:', code);
        console.error('ImageMagick error output:', errorOutput);
        if (errorOutput.includes('gswin') || errorOutput.includes('Ghostscript')) {
          reject(new Error('Ghostscript is required for PDF thumbnails. Install from https://ghostscript.com/releases/gsdnld.html'));
        } else {
          reject(new Error(`ImageMagick PDF exited with code ${code}`));
        }
      }
    });

    magick.on('error', (err) => {
      clearTimeout(timeout);
      if (timedOut) return;
      console.error('ImageMagick spawn error:', err);
      reject(new Error(`ImageMagick spawn error: ${err.message}`));
    });
  });
}

export async function GET(req, { params }) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    const fileId = decodeURIComponent(resolvedParams.id);

    // Get path from query params
    const url = new URL(req.url);
    const relativePath = url.searchParams.get('path') || '';

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileId.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const uploadsDir = path.join(process.cwd(), 'uploads');
    const thumbnailsDir = path.join(process.cwd(), 'thumbnails');
    const filePath = path.join(uploadsDir, relativePath, fileId);

    try {
      await fsPromises.access(filePath);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Get file extension for type detection
    const fileExt = path.extname(fileId).toLowerCase();

    // Supported image, video, and PDF extensions
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'];
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v', '.mpg', '.mpeg'];
    const pdfExtensions = ['.pdf'];

    const isImage = imageExtensions.includes(fileExt);
    const isVideo = videoExtensions.includes(fileExt);
    const isPdf = pdfExtensions.includes(fileExt);

    if (!isImage && !isVideo && !isPdf) {
      return NextResponse.json({ error: 'Thumbnail generation not supported for this file type' }, { status: 404 });
    }

    // Create thumbnail filename - always use JPG format
    const thumbnailFileName = `${relativePath.replace(/[/\\]/g, '_')}_${fileId}.jpg`;
    const thumbnailPath = path.join(thumbnailsDir, thumbnailFileName);

    // Ensure thumbnails directory exists
    try {
      await fsPromises.mkdir(thumbnailsDir, { recursive: true });
    } catch (err) {
      console.error('Failed to create thumbnails directory:', err);
    }

    // Check for old PNG thumbnail and delete it
    const oldPngThumbnailFileName = `${relativePath.replace(/[/\\]/g, '_')}_${fileId}.png`;
    const oldPngThumbnailPath = path.join(thumbnailsDir, oldPngThumbnailFileName);
    try {
      await fsPromises.unlink(oldPngThumbnailPath);
    } catch (err) {
      // File doesn't exist, that's fine
    }

    // Check if JPG thumbnail already exists
    try {
      const thumbnailBuffer = await fsPromises.readFile(thumbnailPath);
      return new NextResponse(thumbnailBuffer, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    } catch (err) {
      // File doesn't exist yet, proceed to generation
    }

    // Generate thumbnail for videos and images using ffmpeg (JPG format)
    try {
      if (isPdf) {
        await generatePdfThumbnail(filePath, thumbnailPath);
      } else {
        await generateThumbnail(filePath, thumbnailPath, isVideo);
      }

      try {
        const thumbnailBuffer = await fsPromises.readFile(thumbnailPath);
        return new NextResponse(thumbnailBuffer, {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000',
          },
        });
      } catch (err) {
        // Failed to read generated file
      }
    } catch (error) {
      console.error(`Thumbnail generation failed for ${isPdf ? 'PDF' : isVideo ? 'video' : 'image'}:`, error.message);
      // Return 404 so the UI can fall back to the icon
      return NextResponse.json(
        {
          error: 'Thumbnail generation not available',
          message: 'FFmpeg is required for thumbnails. Install it from https://ffmpeg.org/download.html',
        },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Thumbnail generation error:', error);
    return NextResponse.json({ error: 'Thumbnail generation failed' }, { status: 500 });
  }
}
