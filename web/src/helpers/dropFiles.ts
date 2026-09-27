/** File + relative folder path helpers for drag-and-drop uploads. */

export type QueuedDropFile = {
  file: File;
  /** Relative directory under drop parent, e.g. "Docs/2024/" (trailing slash) or "". */
  relativePath: string;
};

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void, err?: (e: Error) => void) => void;
  createReader?: () => {
    readEntries: (
      ok: (entries: FileSystemEntryLike[]) => void,
      err?: (e: Error) => void,
    ) => void;
  };
};

function isIgnoredDropFile(file: File) {
  return (
    file.size === 0 &&
    (file.name === "Icon\r" || file.name === "Icon" || file.name === "Icon?")
  );
}

function readDirectoryEntries(
  dirReader: NonNullable<FileSystemEntryLike["createReader"]> extends () => infer R
    ? R
    : never,
): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve) => {
    const all: FileSystemEntryLike[] = [];
    const readBatch = () => {
      dirReader.readEntries(
        (batch) => {
          if (batch.length) {
            all.push(...batch);
            setTimeout(readBatch, 0);
            return;
          }
          resolve(all);
        },
        () => resolve(all),
      );
    };
    readBatch();
  });
}

function traverseFileTree(
  item: FileSystemEntryLike,
  path: string,
  onFile: (file: File, relativePath: string) => void,
  onFolder: (relativePath: string) => void,
  done: (foundFile: boolean) => void,
) {
  if (item.isFile && item.file) {
    item.file(
      (file) => {
        if (!isIgnoredDropFile(file)) onFile(file, path);
        done(true);
      },
      () => done(false),
    );
    return;
  }

  if (item.isDirectory && item.createReader) {
    const folderPath = `${path}${item.name}/`;
    const dirReader = item.createReader();
    void readDirectoryEntries(dirReader).then((entries) => {
      if (!entries.length) {
        onFolder(folderPath);
        done(false);
        return;
      }
      let pending = entries.length;
      let foundFileInDir = false;
      const childDone = (childHasFile: boolean) => {
        if (childHasFile) foundFileInDir = true;
        pending -= 1;
        if (pending === 0) {
          if (!foundFileInDir) onFolder(folderPath);
          done(foundFileInDir);
        }
      };
      for (const entry of entries) {
        traverseFileTree(entry, folderPath, onFile, onFolder, childDone);
      }
    });
  }
}

/**
 * Collect files (and empty folder paths) from a drop event.
 * Prefer dataTransfer.files when webkitRelativePath is present (Chrome folder drop).
 */
export function collectFromDataTransfer(dataTransfer: DataTransfer): Promise<{
  files: QueuedDropFile[];
  emptyFolders: string[];
}> {
  return new Promise((resolve) => {
    const files: QueuedDropFile[] = [];
    const emptyFolders: string[] = [];
    const fileList = Array.from(dataTransfer.files ?? []);
    const items = Array.from(dataTransfer.items ?? []);

    const useFilesList =
      fileList.length > 0 &&
      (fileList.some((f) => Boolean((f as File & { webkitRelativePath?: string }).webkitRelativePath)) ||
        fileList.length > items.length);

    if (useFilesList) {
      for (const file of fileList) {
        if (isIgnoredDropFile(file)) continue;
        const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || "";
        const slash = rel.lastIndexOf("/");
        const relativePath = slash >= 0 ? rel.slice(0, slash + 1) : "";
        files.push({ file, relativePath });
      }
      resolve({ files, emptyFolders });
      return;
    }

    if (!items.length) {
      for (const file of fileList) {
        if (isIgnoredDropFile(file)) continue;
        files.push({ file, relativePath: "" });
      }
      resolve({ files, emptyFolders });
      return;
    }

    let pending = 0;
    let started = false;

    const finishIfDone = () => {
      if (started && pending === 0) resolve({ files, emptyFolders });
    };

    for (const item of items) {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null })
        .webkitGetAsEntry?.();
      if (!entry) continue;
      started = true;
      pending += 1;
      traverseFileTree(
        entry,
        "",
        (file, relativePath) => {
          files.push({ file, relativePath });
        },
        (folderPath) => {
          emptyFolders.push(folderPath);
        },
        () => {
          pending -= 1;
          finishIfDone();
        },
      );
    }

    if (!started) {
      for (const file of fileList) {
        if (isIgnoredDropFile(file)) continue;
        files.push({ file, relativePath: "" });
      }
      resolve({ files, emptyFolders });
    }
  });
}

export function collectFromFileList(list: FileList | File[]): QueuedDropFile[] {
  return Array.from(list).map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || "";
    const slash = rel.lastIndexOf("/");
    const relativePath = slash >= 0 ? rel.slice(0, slash + 1) : "";
    return { file, relativePath };
  });
}

export function pathSegments(relativePath: string): string[] {
  return relativePath
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}
