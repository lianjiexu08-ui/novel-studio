import fs from 'node:fs';
import path from 'node:path';

/**
 * Durable story checkpoint. Adoption is idempotent by (workId, chapterId,
 * version), which is the important boundary when a worker crashes after
 * writing the chapter but before marking its queue task as complete.
 */
export class CheckpointStore {
  constructor(filePath, { now = () => Date.now() } = {}) {
    this.filePath = path.resolve(filePath);
    this.now = now;
    this.state = this.#read();
  }

  adoptChapter({ workId, chapterId, version, content, taskId }) {
    if (!workId || !chapterId || !version || !taskId) {
      throw new Error('workId, chapterId, version and taskId are required');
    }
    const work = (this.state.works[workId] ??= { revision: 0, chapters: [] });
    const existing = work.chapters.find((chapter) => chapter.chapterId === chapterId);
    if (existing) {
      if (existing.version === version && existing.content === content) {
        return { adopted: false, alreadyAdopted: true, chapter: clone(existing) };
      }
      throw new Error(
        `Chapter ${workId}/${chapterId} already adopted at version ${existing.version}`,
      );
    }

    const chapter = {
      chapterId,
      version,
      content,
      taskId,
      adoptedAt: this.now(),
    };
    work.chapters.push(chapter);
    work.revision += 1;
    this.#write();
    return { adopted: true, alreadyAdopted: false, chapter: clone(chapter) };
  }

  getWork(workId) {
    const work = this.state.works[workId];
    return work ? clone(work) : { revision: 0, chapters: [] };
  }

  #read() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, works: {} };
      throw error;
    }
  }

  #write() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.filePath);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

