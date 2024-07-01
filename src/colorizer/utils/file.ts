// Adapted from https://web.dev/patterns/files/open-a-directory by Thomas Steiner.

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string | number;
      mode?: "read" | "readwrite";
      startIn?: "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
    }) => Promise<FileSystemDirectoryHandle>;
  }

  interface FileSystemDirectoryHandle {
    values: () => AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
  }
}

type READ_WRITE_MODE = "read" | "readwrite";

export type FileLoadOptions = {
  onFileDiscovered?: () => void;
  onFileLoaded?: (file: File) => void;
};

const defaultFileLoadOptions: FileLoadOptions = {
  onFileDiscovered: () => {},
  onFileLoaded: () => {},
};

// Feature detection. The API needs to be supported
// and the app not run in an iframe.
export const supportsFileSystemAccess =
  window.showDirectoryPicker &&
  (() => {
    try {
      return window.self === window.top;
    } catch {
      return false;
    }
  })();

/**
 * Recursively parses a directory and returns a list of all files within it.
 * Paths are saved in the `webkitRelativePath` property of the File object.
 * @param dirHandle The directory handle to parse.
 * @param path The root path of the directory.
 * @returns
 */
const getFiles = async (
  dirHandle: FileSystemDirectoryHandle,
  path = dirHandle.name,
  options: FileLoadOptions = defaultFileLoadOptions
): Promise<File[]> => {
  const dirs: Promise<File[]>[] = [];
  const files: Promise<File>[] = [];
  console.log("Parsing directory:", path);

  for await (const entry of dirHandle.values()) {
    const nestedPath = `${path}/${entry.name}`;
    if (entry.kind === "file") {
      options.onFileDiscovered?.();
      files.push(
        entry
          .getFile()
          .then((file) => {
            return Object.defineProperty(file, "webkitRelativePath", {
              configurable: true,
              enumerable: true,
              get: () => nestedPath,
            });
          })
          .then((file) => {
            options.onFileLoaded?.(file);
            return file;
          })
      );
    } else if (entry.kind === "directory") {
      dirs.push(getFiles(entry, nestedPath, options));
    }
  }

  return [...(await Promise.all(dirs)).flat(), ...(await Promise.all(files))];
};

const getFolderName = (path: string): string => {
  return path.substring(0, path.indexOf("/"));
};

// TODO: Make the file list a nested dict to reduce the amount of repeated strings?
const fileListToFileMap = (files: File[]): Record<string, File> => {
  const fileMap: Record<string, File> = {};

  for (const file of files) {
    let path = file.webkitRelativePath;
    // Strip directory name from the path
    path = path.substring(path.indexOf("/") + 1);
    fileMap[path] = file;
  }
  return fileMap;
};

/**
 * Creates a file picker dialog to select a directory and returns a list of files (as File objects)
 * within the directory.
 */
const openDirectoryAndGetFileList = async (
  mode: READ_WRITE_MODE = "read",
  options: FileLoadOptions = defaultFileLoadOptions
): Promise<File[] | null> => {
  // If the File System Access API is supported…
  if (window.showDirectoryPicker && supportsFileSystemAccess) {
    try {
      const handle = await window.showDirectoryPicker({
        mode,
      });
      return await getFiles(handle, undefined, options);
    } catch (err) {
      if (typeof err === "string") {
        if (!err.includes("AbortError")) {
          console.error(err);
        }
      } else if (err instanceof Error) {
        if (err.name !== "AbortError") {
          console.error(err);
        }
      } else {
        console.error(err);
      }
    }
  } else {
    // Fallback if the File System Access API is not supported.
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.webkitdirectory = true;
      input.id = "file-input";

      input.addEventListener("change", () => {
        let files = Array.from(input.files || []);
        console.log("File count:", files.length, "files: ", files);
        resolve(files);
        document.removeChild(input);
      });

      if ("showPicker" in HTMLInputElement.prototype) {
        input.showPicker();
      } else {
        input.click();
      }
    });
  }
  return null;
};

/**
 * Show a prompt and open a directory to get a list of files.
 * @param mode
 * @returns
 */
export const openDirectory = async (
  mode: READ_WRITE_MODE = "read",
  options: FileLoadOptions = defaultFileLoadOptions
): Promise<{ folderName: string; fileMap: Record<string, File> } | null> => {
  const files = await openDirectoryAndGetFileList(mode, options);
  console.log("Files loaded.");
  console.log(files);
  console.log("Parsing files...");
  if (files === null) {
    return null;
  }

  const fileMap = fileListToFileMap(files);
  const folderName = getFolderName(files[0].webkitRelativePath);
  console.log("Done parsing files.");
  return { folderName, fileMap };
};
