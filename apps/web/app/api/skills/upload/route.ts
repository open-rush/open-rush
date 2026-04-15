/**
 * POST /api/skills/upload
 *
 * Receives a skill folder as multipart/form-data, packages it as .tgz,
 * uploads to MinIO, extracts SKILL.md, stores metadata in DB.
 *
 * Form fields:
 * - files: File[] (the skill folder contents)
 * - name: string (@scope/skill-name)
 * - description: string
 * - category: string
 * - tags: string (comma-separated)
 * - visibility: string
 * - license: string
 * - version: string
 * - sourceUrl: string (optional, for remote URL mode)
 */

import { createHash } from 'node:crypto';
import { SkillRegistryService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';
import { createStorageService } from '@open-rush/integrations';

import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

const storage = createStorageService({
  bucket: 'openrush-skills',
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  forcePathStyle: true,
  accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
});

export async function POST(req: Request) {
  const userId = await requireAuth();

  const formData = await req.formData();
  const name = formData.get('name') as string;
  const description = (formData.get('description') as string) ?? '';
  const category = (formData.get('category') as string) ?? 'general';
  const tags = ((formData.get('tags') as string) ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const visibility = (formData.get('visibility') as string) ?? 'public';
  const license = (formData.get('license') as string) ?? '';
  const version = (formData.get('version') as string) ?? '1.0.0';
  const sourceUrl = (formData.get('sourceUrl') as string) ?? '';
  const skillMdContent = (formData.get('skillMdContent') as string) ?? '';

  if (!name?.trim()) {
    return apiError(400, 'INVALID_INPUT', 'name is required');
  }

  // Collect uploaded files
  const files: Array<{ name: string; path: string; buffer: Buffer }> = [];
  for (const [key, value] of formData.entries()) {
    if (key === 'files' && value instanceof File) {
      const buffer = Buffer.from(await value.arrayBuffer());
      files.push({
        name: value.name,
        path: (value as File & { webkitRelativePath?: string }).webkitRelativePath || value.name,
        buffer,
      });
    }
  }

  // Extract SKILL.md content from files if not provided directly
  let mdContent = skillMdContent;
  if (!mdContent) {
    const skillMdFile = files.find((f) => f.name === 'SKILL.md');
    if (skillMdFile) {
      mdContent = skillMdFile.buffer.toString('utf-8');
    }
  }

  // Create .tgz buffer from files (simple tar-like concatenation for now)
  // For a proper implementation, we'd use tar.pack(), but to avoid adding
  // a dependency, we store files individually under a prefix
  const artifactPrefix = `skills/${name.replace(/^@/, '').replace(/\//, '-')}/${version}`;

  // Upload each file to S3
  for (const file of files) {
    const key = `${artifactPrefix}/${file.path}`;
    await storage.upload(key, file.buffer, {
      contentType: getContentType(file.name),
    });
  }

  // Also upload a combined tarball marker with SHA256 integrity
  const allContent = Buffer.concat(files.map((f) => f.buffer));
  const sha256 = createHash('sha256').update(allContent).digest('base64');
  const integrity = `sha256-${sha256}`;

  await storage.upload(`${artifactPrefix}/.integrity`, integrity, {
    contentType: 'text/plain',
  });

  // Create or update skill in registry
  const service = new SkillRegistryService(getDbClient());
  const existing = await service.getByName(name);

  if (existing) {
    await service.update(name, {
      description,
      category,
      tags,
      visibility,
      skillMdContent: mdContent || undefined,
      license,
    });
  } else {
    await service.create({
      name,
      description,
      sourceType: sourceUrl ? 'github' : 'local',
      sourceUrl: sourceUrl || undefined,
      category,
      tags,
      visibility,
      skillMdContent: mdContent || undefined,
      license,
      createdById: userId,
    });
  }

  // Update latest version
  await service.update(name, { sourceUrl: `s3://${artifactPrefix}` });

  return apiSuccess(
    {
      name,
      version,
      integrity,
      artifactPrefix,
      fileCount: files.length,
      skillMdFound: !!mdContent,
    },
    201
  );
}

function getContentType(filename: string): string {
  if (filename.endsWith('.md')) return 'text/markdown';
  if (filename.endsWith('.ts') || filename.endsWith('.tsx')) return 'text/typescript';
  if (filename.endsWith('.js') || filename.endsWith('.jsx')) return 'text/javascript';
  if (filename.endsWith('.json')) return 'application/json';
  if (filename.endsWith('.yaml') || filename.endsWith('.yml')) return 'text/yaml';
  return 'application/octet-stream';
}
