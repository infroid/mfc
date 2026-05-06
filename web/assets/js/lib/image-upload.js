// MFC.imageUpload — shared helper for browser image uploads to the
// recipe-images bucket. Compresses client-side then uses supabase-js to
// upload via the admin's authenticated session (RLS gated by is_admin()).
//
// All paths are scoped to <recipeId>/<filename>. Path traversal is rejected.

(function () {
  const BUCKET = "recipe-images";
  const HERO_OPTS = {
    maxSizeMB: 0.5,
    maxWidthOrHeight: 2048,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.8,
  };
  const STEP_OPTS = {
    maxSizeMB: 0.3,
    maxWidthOrHeight: 1024,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.8,
  };

  function ensureSafePath(recipeId, filename) {
    if (!recipeId || /[/\\]/.test(recipeId) || recipeId.includes("..")) {
      throw new Error(`invalid recipeId: ${recipeId}`);
    }
    if (!filename || /[/\\]/.test(filename) || filename.includes("..")) {
      throw new Error(`invalid filename: ${filename}`);
    }
    return `${recipeId}/${filename}`;
  }

  function publicUrl(path) {
    const sb = window.MFC?.supabase;
    if (!sb) throw new Error("MFC.supabase not initialised");
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function compress(file, kind) {
    const opts = kind === "step" ? STEP_OPTS : HERO_OPTS;
    if (!window.imageCompression) {
      // browser-image-compression CDN load failed — fall back to raw upload
      return file;
    }
    return await window.imageCompression(file, opts);
  }

  async function upload(file, { recipeId, filename, kind }) {
    const path = ensureSafePath(recipeId, filename);
    const sb = window.MFC?.supabase;
    if (!sb) throw new Error("MFC.supabase not initialised");
    const compressed = await compress(file, kind);
    const { error } = await sb.storage.from(BUCKET).upload(path, compressed, {
      cacheControl: "3600",
      upsert: true,
      contentType: "image/jpeg",
    });
    if (error) throw error;
    return publicUrl(path);
  }

  function urlFor(recipeId, filename) {
    return publicUrl(ensureSafePath(recipeId, filename));
  }

  async function remove(paths) {
    const sb = window.MFC?.supabase;
    if (!sb) throw new Error("MFC.supabase not initialised");
    if (!Array.isArray(paths) || paths.length === 0) return;
    paths.forEach((p) => {
      if (typeof p !== "string" || !p.includes("/") || p.includes("..")) {
        throw new Error(`invalid storage path: ${p}`);
      }
    });
    const { error } = await sb.storage.from(BUCKET).remove(paths);
    if (error) throw error;
  }

  async function move(from, to) {
    const sb = window.MFC?.supabase;
    if (!sb) throw new Error("MFC.supabase not initialised");
    const { error } = await sb.storage.from(BUCKET).move(from, to);
    if (error) throw error;
  }

  window.MFC = window.MFC || {};
  window.MFC.imageUpload = { upload, urlFor, remove, move };
})();
