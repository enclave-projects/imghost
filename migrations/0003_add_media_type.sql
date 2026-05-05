-- Migration: 0003_add_media_type
-- Adds media_type column to images table to support video uploads

ALTER TABLE images ADD COLUMN media_type TEXT NOT NULL DEFAULT 'image';
