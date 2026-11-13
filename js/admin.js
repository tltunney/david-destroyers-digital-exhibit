// Admin mode: edit exhibit titles, text and photos from inside the museum, then publish the changes
// to the GitHub repository, which republishes the site for everyone (GitHub Pages, about a minute).
//
// How the password works: the first time, someone pastes a GitHub token (made on GitHub, allowed to
// change only this repository) and chooses a team password. The token is encrypted with the password
// (AES-GCM, key stretched with PBKDF2) and saved as content/admin.json. After that, anyone who knows
// the password can unlock admin mode; without it, the saved token is unreadable. The password check
// is the decryption itself, so there is no password stored anywhere.
//
// Edits are saved to content/exhibits.json (one entry per exhibit id) and photos to content/images/.
// main.js reads content/exhibits.json at startup and lays it over the exhibits in config.js.

const PBKDF2_ROUNDS = 600000;
const MAX_PHOTO = 1600; // longest side of an uploaded photo, in pixels
const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function passwordKey(password, salt, rounds) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: rounds, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function lockToken(token, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt, PBKDF2_ROUNDS);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token)));
  return { version: 1, kdf: 'PBKDF2-SHA256', rounds: PBKDF2_ROUNDS, salt: toBase64(salt), iv: toBase64(iv), token: toBase64(data) };
}
async function unlockToken(box, password) {
  const key = await passwordKey(password, fromBase64(box.salt), box.rounds);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(box.iv) }, key, fromBase64(box.token));
  return dec.decode(data); // throws if the password is wrong
}

// Just enough of the GitHub API to put several files in one commit.
class GitHub {
  constructor(repo, branch, token) {
    Object.assign(this, { repo, branch, token });
  }
  async call(path, options = {}) {
    const res = await fetch(`https://api.github.com/repos/${this.repo}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (res.status === 404 && options.allow404) return null;
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      const err = new Error(detail.message || `GitHub said ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
  async canWrite() {
    const info = await this.call('');
    return !!info.permissions?.push;
  }
  async readJSON(path) {
    const file = await this.call(`/contents/${path}?ref=${encodeURIComponent(this.branch)}`, { allow404: true });
    if (!file) return null;
    if (typeof file.content !== 'string') throw new Error(`GitHub didn't send the contents of ${path}.`);
    return JSON.parse(dec.decode(fromBase64(file.content.replace(/\s/g, ''))));
  }
  // files: [{ path, text } | { path, base64 }]
  async commit(files, message, retry = true) {
    try {
      const ref = await this.call(`/git/ref/heads/${encodeURIComponent(this.branch)}`);
      const head = await this.call(`/git/commits/${ref.object.sha}`);
      const tree = [];
      for (const f of files) {
        if (f.base64) {
          const blob = await this.call('/git/blobs', { method: 'POST', body: JSON.stringify({ content: f.base64, encoding: 'base64' }) });
          tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
        } else tree.push({ path: f.path, mode: '100644', type: 'blob', content: f.text });
      }
      const newTree = await this.call('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: head.tree.sha, tree }) });
      const commit = await this.call('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: newTree.sha, parents: [head.sha] }) });
      await this.call(`/git/refs/heads/${encodeURIComponent(this.branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
    } catch (err) {
      // someone else published at the same moment: start again from their commit
      if (retry && (err.status === 409 || err.status === 422)) return this.commit(files, message, false);
      throw err;
    }
  }
}

// Shrinks a photo to at most MAX_PHOTO pixels on its longest side and returns a JPEG data URL.
async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file could not be read as a picture.'));
      i.src = url;
    });
    const scale = Math.min(1, MAX_PHOTO / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // transparent PNGs get a white background
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const STYLE = `
#admin-bar { position: fixed; top: max(10px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); z-index: 30;
  display: flex; align-items: center; flex-wrap: wrap; justify-content: center; gap: 8px 12px; max-width: calc(100% - 120px);
  padding: 8px 14px; border-radius: 999px; background: rgba(150, 30, 30, 0.92); color: #fff; font-size: 0.85rem; box-shadow: 0 6px 20px rgba(0,0,0,0.4); }
#admin-bar button { padding: 5px 12px; border: 1px solid rgba(255,255,255,0.6); border-radius: 999px; background: transparent; color: #fff; font: inherit; font-weight: bold; cursor: pointer; }
#admin-bar button.primary { background: #fff; color: #8c1d1d; border-color: #fff; }
#admin-bar button:disabled { opacity: 0.5; cursor: default; }
#admin-status:empty { display: none; }
.admin-dialog { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(5,5,8,0.65); backdrop-filter: blur(3px); }
.admin-dialog .card { text-align: left; }
.admin-dialog h2 { margin: 0 0 6px; font-size: 1.4rem; }
.admin-dialog p, .admin-dialog li { color: var(--muted); line-height: 1.5; font-size: 0.92rem; }
.admin-dialog label { display: block; margin: 14px 0 4px; font-size: 0.85rem; font-weight: bold; }
.admin-dialog input[type=text], .admin-dialog input[type=password], .admin-dialog textarea {
  width: 100%; padding: 10px 12px; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; background: rgba(0,0,0,0.35); color: var(--text); font: inherit; font-size: 16px; }
.admin-dialog textarea { min-height: 140px; resize: vertical; line-height: 1.5; }
.admin-dialog .row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
.admin-dialog .row button { padding: 10px 18px; border: 1px solid rgba(255,255,255,0.35); border-radius: 999px; background: transparent; color: var(--text); font: inherit; font-weight: bold; cursor: pointer; }
.admin-dialog .row button.primary { background: var(--accent); color: #111; border-color: var(--accent); }
.admin-dialog .error { color: #ff9a8a; min-height: 1.2em; margin: 10px 0 0; }
.admin-dialog .photo { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.admin-dialog .photo img { max-width: 160px; max-height: 110px; border-radius: 6px; }
.admin-dialog .photo img:not([src]) { display: none; }
.admin-dialog .small { font-size: 0.8rem; }
`;

const html = (strings, ...values) => strings.reduce((out, s, i) => out + s + (values[i] ?? ''), '');

export class Admin {
  constructor({ repo, branch = 'main', contentFile = 'content/exhibits.json', onBusy = () => {} }) {
    Object.assign(this, { repo, branch, contentFile, onBusy });
    this.active = false;
    this.editorOpen = false;
    this.gh = null;
    this.pending = {}; // exhibit id -> fields to save
    this.photos = {}; // exhibit id -> new photo as a data URL, until it is published
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    this.bar = document.createElement('div');
    this.bar.id = 'admin-bar';
    this.bar.className = 'hidden';
    this.bar.innerHTML = html`<strong>Admin mode</strong><span id="admin-hint">Click or tap an exhibit to edit it</span>
      <span id="admin-status"></span><button id="admin-publish" class="primary" disabled>Publish</button><button id="admin-exit">Exit</button>`;
    document.body.append(this.bar);
    this.bar.querySelector('#admin-publish').addEventListener('click', () => this.publish());
    this.bar.querySelector('#admin-exit').addEventListener('click', () => this.exit());
    window.addEventListener('beforeunload', (e) => {
      if (Object.keys(this.pending).length) e.preventDefault();
    });
  }

  get unpublished() {
    return Object.keys(this.pending).length;
  }

  status(text) {
    this.bar.querySelector('#admin-status').textContent = text;
  }

  updateBar() {
    const n = this.unpublished;
    const button = this.bar.querySelector('#admin-publish');
    button.disabled = n === 0;
    button.textContent = n ? `Publish ${n} change${n === 1 ? '' : 's'}` : 'Publish';
  }

  dialog(content) {
    const box = document.createElement('div');
    box.className = 'admin-dialog';
    box.innerHTML = `<div class="card">${content}</div>`;
    // keep key presses in the form from reaching the museum's controls
    box.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.append(box);
    return box;
  }

  // Called from the settings menu.
  async open() {
    if (this.active) return;
    let box = null;
    try {
      const res = await fetch(`content/admin.json?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) box = await res.json();
    } catch {}
    if (box) this.askPassword(box);
    else this.setup();
  }

  askPassword(box) {
    const d = this.dialog(html`
      <h2>Admin mode</h2>
      <p>Enter the team password to edit exhibit text and photos.</p>
      <form>
        <label for="admin-pass">Password</label>
        <input id="admin-pass" type="password" autocomplete="current-password" required />
        <p class="error"></p>
        <div class="row"><button class="primary" type="submit">Unlock</button><button type="button" data-cancel>Cancel</button></div>
        <p class="small">Need a new token or password? <a href="#" data-reset>Set up admin mode again</a></p>
      </form>`);
    const error = d.querySelector('.error');
    d.querySelector('input').focus();
    d.querySelector('[data-cancel]').onclick = () => d.remove();
    d.querySelector('[data-reset]').onclick = (e) => {
      e.preventDefault();
      d.remove();
      this.setup();
    };
    d.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      error.textContent = 'Checking…';
      try {
        const token = await unlockToken(box, d.querySelector('#admin-pass').value);
        this.gh = new GitHub(this.repo, this.branch, token);
        if (!(await this.gh.canWrite())) throw new Error('The saved GitHub token can no longer change this repository. Set up admin mode again with a new token.');
        d.remove();
        this.enter();
      } catch (err) {
        error.textContent = err.name === 'OperationError' ? 'Wrong password.' : err.message;
      }
    };
  }

  setup() {
    const d = this.dialog(html`
      <h2>Set up admin mode</h2>
      <p>This is done once. Afterwards, anyone with the team password can edit exhibits.</p>
      <ol>
        <li>On GitHub, open <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens</b> and choose <b>Generate new token</b>.</li>
        <li>Under <b>Repository access</b>, choose <b>Only select repositories</b> and pick <b>${this.repo}</b>.</li>
        <li>Under <b>Permissions → Repository permissions</b>, set <b>Contents</b> to <b>Read and write</b>. Give it an expiration date after your class ends.</li>
        <li>Paste the token below and choose a team password.</li>
      </ol>
      <form>
        <label for="admin-token">GitHub token</label>
        <input id="admin-token" type="password" autocomplete="off" required placeholder="github_pat_…" />
        <label for="admin-new-pass">Team password</label>
        <input id="admin-new-pass" type="password" autocomplete="new-password" minlength="10" required />
        <label for="admin-new-pass2">Type it again</label>
        <input id="admin-new-pass2" type="password" autocomplete="new-password" required />
        <p class="small">Use at least 10 characters; a few random words work well. Anyone with this password can change the exhibits, and the token is saved in the repository locked with it.</p>
        <p class="error"></p>
        <div class="row"><button class="primary" type="submit">Save and unlock</button><button type="button" data-cancel>Cancel</button></div>
      </form>`);
    const error = d.querySelector('.error');
    d.querySelector('input').focus();
    d.querySelector('[data-cancel]').onclick = () => d.remove();
    d.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const token = d.querySelector('#admin-token').value.trim();
      const pass = d.querySelector('#admin-new-pass').value;
      if (pass !== d.querySelector('#admin-new-pass2').value) {
        error.textContent = 'The two passwords are different.';
        return;
      }
      error.textContent = 'Checking the token…';
      try {
        const gh = new GitHub(this.repo, this.branch, token);
        if (!(await gh.canWrite())) throw new Error('This token can’t change the repository. Check that Contents is set to “Read and write” for it.');
        error.textContent = 'Saving…';
        const box = await lockToken(token, pass);
        await gh.commit([{ path: 'content/admin.json', text: JSON.stringify(box, null, 2) + '\n' }], 'Set up admin mode');
        this.gh = gh;
        d.remove();
        this.enter();
      } catch (err) {
        error.textContent = err.status === 401 ? 'GitHub didn’t accept that token. Copy it again and paste the whole thing.' : err.message;
      }
    };
  }

  enter() {
    this.active = true;
    this.bar.classList.remove('hidden');
    this.updateBar();
    this.status('');
  }

  exit() {
    if (this.unpublished && !confirm('You have changes that are not published yet. Leave admin mode and lose them?')) return;
    for (const id of Object.keys(this.pending)) delete this.pending[id];
    this.active = false;
    this.gh = null;
    this.bar.classList.add('hidden');
  }

  // Edit one exhibit. `exhibit` is the object the museum shows; `onClose` resumes the museum.
  edit(exhibit, room, onClose) {
    this.editorOpen = true;
    const isPanel = exhibit.type === 'panel';
    const d = this.dialog(html`
      <h2>Edit exhibit</h2>
      <p class="small">${room.name} · ${exhibit.type}</p>
      <form>
        <label for="ed-title">Title</label>
        <input id="ed-title" type="text" />
        ${isPanel ? '' : '<label for="ed-subtitle">Subtitle (artist, date, or a short line)</label><input id="ed-subtitle" type="text" />'}
        <label for="ed-text">${isPanel ? 'Wall text' : 'Description (shown when a visitor opens the exhibit)'}</label>
        <textarea id="ed-text"></textarea>
        <label>Photo</label>
        <div class="photo"><img id="ed-preview" alt="" /><input id="ed-file" type="file" accept="image/*" /><button type="button" id="ed-remove">Remove photo</button></div>
        <p class="error"></p>
        <div class="row"><button class="primary" type="submit">Apply</button><button type="button" data-cancel>Cancel</button></div>
        <p class="small">Apply shows the change here right away. Use <b>Publish</b> at the top of the screen to save everything for all visitors.</p>
      </form>`);
    const $ = (sel) => d.querySelector(sel);
    $('#ed-title').value = exhibit.title ?? '';
    if (!isPanel) $('#ed-subtitle').value = exhibit.subtitle ?? '';
    $('#ed-text').value = (isPanel ? exhibit.text : Array.isArray(exhibit.description) ? exhibit.description.join('\n') : exhibit.description) ?? '';
    let photo = exhibit.image ?? '';
    const preview = $('#ed-preview');
    const showPhoto = () => (photo ? (preview.src = photo) : preview.removeAttribute('src'));
    showPhoto();
    $('#ed-file').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      $('.error').textContent = 'Preparing photo…';
      try {
        photo = await shrinkPhoto(file);
        showPhoto();
        $('.error').textContent = '';
      } catch (err) {
        $('.error').textContent = err.message;
      }
    };
    $('#ed-remove').onclick = () => {
      photo = '';
      $('#ed-file').value = '';
      showPhoto();
    };
    const close = () => {
      d.remove();
      this.editorOpen = false;
      onClose();
    };
    $('[data-cancel]').onclick = close;
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    $('#ed-title').focus();
    $('form').onsubmit = (e) => {
      e.preventDefault();
      const fields = { title: $('#ed-title').value.trim(), image: photo };
      if (isPanel) fields.text = $('#ed-text').value.trim();
      else {
        fields.subtitle = $('#ed-subtitle').value.trim();
        fields.description = $('#ed-text').value.trim();
      }
      if (photo.startsWith('data:')) this.photos[exhibit.id] = photo;
      else delete this.photos[exhibit.id];
      this.pending[exhibit.id] = fields;
      Object.assign(exhibit, fields);
      exhibit.refresh?.();
      this.updateBar();
      this.status('');
      close();
    };
  }

  async publish() {
    if (!this.unpublished || !this.gh) return;
    const button = this.bar.querySelector('#admin-publish');
    button.disabled = true;
    this.status('Publishing…');
    this.onBusy(true);
    try {
      const files = [];
      const saving = structuredClone(this.pending);
      for (const [id, data] of Object.entries(this.photos)) {
        if (!saving[id]) continue;
        const name = id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
        const path = `content/images/${name}-${Date.now().toString(36)}.jpg`;
        files.push({ path, base64: data.split(',')[1] });
        saving[id].image = path;
      }
      // merge with what's already published, so teammates' edits are kept
      const published = (await this.gh.readJSON(this.contentFile)) ?? {};
      files.push({ path: this.contentFile, text: JSON.stringify({ ...published, ...saving }, null, 2) + '\n' });
      const n = Object.keys(saving).length;
      await this.gh.commit(files, `Update ${n} exhibit${n === 1 ? '' : 's'} from admin mode`);
      for (const id of Object.keys(saving)) {
        delete this.pending[id];
        delete this.photos[id];
      }
      this.status('Published! Everyone will see it in about a minute.');
    } catch (err) {
      this.status(`Couldn’t publish: ${err.message}`);
    } finally {
      this.onBusy(false);
      this.updateBar();
    }
  }
}
