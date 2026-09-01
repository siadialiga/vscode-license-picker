const vscode = require('vscode');
const { loadLicenses } = require('./githubLicenses');

const VIEW_TYPE = 'licensePicker.editor';

function fillPlaceholders(text, year, fullname, forPreview = false) {
  const yearTrimmed = String(year ?? '').trim();
  const nameTrimmed = String(fullname ?? '').trim();
  const y = yearTrimmed || (forPreview ? '[year]' : String(new Date().getFullYear()));
  const n = nameTrimmed || (forPreview ? '[fullname]' : 'Your Name');
  let result = text.split('[year]').join(y);
  result = result.split('[fullname]').join(n);
  result = result.replace(/<year>/gi, y);
  result = result.replace(/<name of author>/gi, n);
  result = result.replace(/<copyright holders?>/gi, n);
  return result;
}

function activate(context) {
  const provider = new LicenseEditorProvider(context);
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: false
  }));

  context.subscriptions.push(vscode.commands.registerCommand('licensePicker.createLicense', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      vscode.window.showErrorMessage('Open a folder/workspace first.');
      return;
    }
    const uri = vscode.Uri.joinPath(folders[0].uri, 'LICENSE');
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      await vscode.workspace.fs.writeFile(uri, Buffer.from('', 'utf8'));
    }
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('licensePicker.openVisual', async (uri) => {
    const target = uri || vscode.window.activeTextEditor?.document.uri;
    if (target) await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
  }));
}

class LicenseEditorProvider {
  constructor(context) {
    this.context = context;
    this.templates = new Map();
    this.licenses = [];
    this.loadPromise = null;
  }

  async ensureLicenses(forceRefresh = false) {
    if (!forceRefresh && this.licenses.length) return this.licenses;
    if (!this.loadPromise || forceRefresh) {
      this.loadPromise = loadLicenses(this.context.globalState, { forceRefresh })
        .then(licenses => {
          this.licenses = licenses;
          this.templates = new Map(licenses.map(license => [license.id, license.text]));
          return licenses;
        })
        .catch(error => {
          this.loadPromise = null;
          throw error;
        });
    }
    return this.loadPromise;
  }

  async resolveCustomTextEditor(document, webviewPanel) {
    const webview = webviewPanel.webview;
    webview.options = { enableScripts: true };
    webview.html = this.getHtml(webview);

    const sendState = async () => {
      webview.postMessage({ type: 'loading' });
      try {
        const licenses = await this.ensureLicenses();
        webview.postMessage({
          type: 'state',
          text: document.getText(),
          licenses: licenses.map(({ id, name, spdx, description, permissions, limitations, conditions, text }) => ({
            id, name, spdx, description, permissions, limitations, conditions, text
          }))
        });
      } catch (error) {
        webview.postMessage({
          type: 'error',
          message: 'Could not load licenses from GitHub. Check your internet connection and try again.'
        });
      }
    };

    const changeSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) sendState();
    });
    webviewPanel.onDidDispose(() => changeSubscription.dispose());

    webview.onDidReceiveMessage(async msg => {
      if (msg.type === 'ready' || msg.type === 'retry') {
        if (msg.type === 'retry') {
          this.licenses = [];
          this.loadPromise = null;
        }
        await sendState();
        return;
      }
      if (msg.type === 'apply') {
        const template = this.templates.get(msg.id);
        if (!template) return;
        const text = fillPlaceholders(template, msg.year, msg.fullname, false);
        await this.replaceDocument(document, text.endsWith('\n') ? text : text + '\n');
        vscode.window.setStatusBarMessage(`License Picker: ${msg.name || msg.id} applied`, 2500);
        return;
      }
      if (msg.type === 'openText') {
        await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
      }
    });
  }

  async replaceDocument(document, newText) {
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    edit.replace(document.uri, fullRange, newText);
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) vscode.window.showErrorMessage('Could not update the LICENSE file.');
  }

  getHtml(webview) {
    const nonce = getNonce();
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    const webviewFillPlaceholders = [
      'function fillPlaceholders(text, year, fullname, forPreview) {',
      '  const yearTrimmed = String(year ?? "").trim();',
      '  const nameTrimmed = String(fullname ?? "").trim();',
      '  const y = yearTrimmed || (forPreview ? "[year]" : String(new Date().getFullYear()));',
      '  const n = nameTrimmed || (forPreview ? "[fullname]" : "Your Name");',
      '  let result = text.split("[year]").join(y);',
      '  result = result.split("[fullname]").join(n);',
      '  result = result.replace(/<year>/gi, y);',
      '  result = result.replace(/<name of author>/gi, n);',
      '  result = result.replace(/<copyright holders?>/gi, n);',
      '  return result;',
      '}'
    ].join('\n');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>License Picker</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  button, input { font: inherit; }
  .app { height: 100vh; display: grid; grid-template-rows: 58px 1fr; overflow: hidden; }
  .topbar { display:flex; align-items:center; justify-content:space-between; gap:16px; padding: 0 22px; border-bottom:1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
  .title { font-size:16px; font-weight:600; }
  .ghost { border:1px solid var(--vscode-button-border, var(--vscode-panel-border)); background:transparent; color:var(--vscode-foreground); border-radius:6px; padding:7px 11px; cursor:pointer; }
  .ghost:hover { background:var(--vscode-toolbar-hoverBackground); }
  .layout { display:grid; grid-template-columns: 270px minmax(440px, 1fr) 300px; min-height:0; }
  .sidebar { border-right:1px solid var(--vscode-panel-border); overflow:auto; background:var(--vscode-sideBar-background); }
  .license-item { width:100%; border:0; border-bottom:1px solid var(--vscode-panel-border); text-align:left; background:transparent; color:var(--vscode-sideBar-foreground); padding:14px 18px; cursor:pointer; line-height:1.3; position:relative; }
  .license-item:hover { background:var(--vscode-list-hoverBackground); }
  .license-item.active { background:var(--vscode-list-activeSelectionBackground); color:var(--vscode-list-activeSelectionForeground); }
  .license-item.active::before { content:''; position:absolute; inset:0 auto 0 0; width:3px; background:var(--vscode-focusBorder); }
  .spdx { display:block; opacity:.58; font-size:11px; margin-top:5px; }
  .main { min-width:0; overflow:auto; padding:24px; }
  .summary { max-width:980px; }
  .summary h1 { font-size:20px; margin:0 0 8px; }
  .summary p { line-height:1.55; opacity:.9; margin:0 0 24px; }
  .traits { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:22px; padding-bottom:22px; border-bottom:1px solid var(--vscode-panel-border); }
  .trait h3 { margin:0 0 10px; font-size:13px; }
  .trait ul { padding:0; margin:0; list-style:none; display:grid; gap:9px; }
  .trait li { font-size:12px; line-height:1.35; display:flex; gap:8px; align-items:flex-start; }
  .ok { color:var(--vscode-testing-iconPassed, #2ea043); }
  .bad { color:var(--vscode-testing-iconFailed, #f85149); }
  .info { color:var(--vscode-notificationsInfoIcon-foreground, #58a6ff); }
  .preview-wrap { margin-top:22px; border:1px solid var(--vscode-panel-border); border-radius:8px; overflow:hidden; background:var(--vscode-textCodeBlock-background); }
  .preview-head { padding:10px 13px; border-bottom:1px solid var(--vscode-panel-border); font-size:12px; opacity:.75; display:flex; justify-content:space-between; }
  pre { margin:0; padding:18px; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.5; font-family:var(--vscode-editor-font-family); font-size:var(--vscode-editor-font-size); max-height:52vh; overflow:auto; }
  .right { border-left:1px solid var(--vscode-panel-border); padding:24px 22px; background:var(--vscode-sideBar-background); overflow:auto; }
  .right h2 { font-size:15px; margin:0 0 10px; }
  .right p { font-size:12px; opacity:.8; line-height:1.5; margin:0 0 18px; }
  .field { margin:0 0 13px; }
  .field label { display:block; font-size:11px; opacity:.72; margin-bottom:6px; }
  .field input { width:100%; border:1px solid var(--vscode-input-border, transparent); background:var(--vscode-input-background); color:var(--vscode-input-foreground); padding:8px 9px; border-radius:4px; outline:none; }
  .field input:focus { border-color:var(--vscode-focusBorder); }
  .primary { width:100%; margin-top:6px; border:0; border-radius:6px; padding:9px 12px; background:var(--vscode-button-background); color:var(--vscode-button-foreground); cursor:pointer; font-weight:600; }
  .primary:hover { background:var(--vscode-button-hoverBackground); }
  .empty { opacity:.65; padding:40px; text-align:center; }
  .status { opacity:.75; padding:40px; text-align:center; line-height:1.6; }
  .status button { margin-top:12px; }
  @media (max-width: 900px) { .layout { grid-template-columns:220px 1fr; } .right { grid-column:1 / -1; border-left:0; border-top:1px solid var(--vscode-panel-border); } .app { overflow:auto; height:auto; } }
</style>
</head>
<body>
<div class="app">
  <div class="topbar">
    <div class="title">Add a license to your project</div>
    <button id="openText" class="ghost">Open as Text</button>
  </div>
  <div class="layout">
    <aside id="list" class="sidebar"></aside>
    <main class="main"><div id="content" class="status">Loading licenses from GitHub…</div></main>
    <aside class="right">
      <h2>Use this license</h2>
      <p>Choose a license, review the full text, then write it directly into this LICENSE file.</p>
      <div class="field"><label for="year">Copyright year</label><input id="year" /></div>
      <div class="field"><label for="fullname">Copyright holder / name</label><input id="fullname" placeholder="Your name or organization" /></div>
      <button id="apply" class="primary" disabled>Apply selected license</button>
    </aside>
  </div>
</div>
<script nonce="${nonce}">
${webviewFillPlaceholders}
  const vscode = acquireVsCodeApi();
  let licenses = [];
  let selected = null;

  const listEl = document.getElementById('list');
  const contentEl = document.getElementById('content');
  const yearEl = document.getElementById('year');
  const fullnameEl = document.getElementById('fullname');
  const applyEl = document.getElementById('apply');
  yearEl.value = new Date().getFullYear();

  function esc(s='') { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function icon(kind) { return kind === 'permission' ? '<span class="ok">✓</span>' : kind === 'limitation' ? '<span class="bad">×</span>' : '<span class="info">ⓘ</span>'; }
  function setApplyEnabled(enabled) { applyEl.disabled = !enabled; }
  function showStatus(message, showRetry) {
    setApplyEnabled(false);
    listEl.innerHTML = '';
    contentEl.className = 'status';
    contentEl.innerHTML = esc(message) + (showRetry ? '<br><button id="retry" class="ghost">Retry</button>' : '');
    if (showRetry) document.getElementById('retry').addEventListener('click', () => vscode.postMessage({ type: 'retry' }));
  }
  function renderList() {
    listEl.innerHTML = licenses.map(l => '<button class="license-item '+(selected?.id===l.id?'active':'')+'" data-id="'+l.id+'">'+esc(l.name)+'<span class="spdx">'+esc(l.spdx)+'</span></button>').join('');
    listEl.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => select(btn.dataset.id)));
  }
  function select(id) {
    selected = licenses.find(l => l.id === id) || licenses[0];
    renderList(); renderContent();
  }
  function trait(title, items, kind) {
    return '<section class="trait"><h3>'+title+'</h3><ul>'+(items.length ? items.map(x=>'<li>'+icon(kind)+'<span>'+esc(x)+'</span></li>').join('') : '<li><span style="opacity:.55">None</span></li>')+'</ul></section>';
  }
  function renderContent() {
    if (!selected) return;
    const preview = fillPlaceholders(selected.text, yearEl.value, fullnameEl.value, true);
    contentEl.className = 'summary';
    contentEl.innerHTML = '<h1>'+esc(selected.name)+'</h1><p>'+esc(selected.description)+'</p>'+
      '<div class="traits">'+trait('Permissions',selected.permissions,'permission')+trait('Limitations',selected.limitations,'limitation')+trait('Conditions',selected.conditions,'condition')+'</div>'+
      '<div class="preview-wrap"><div class="preview-head"><span>License text preview</span><span>'+esc(selected.spdx)+'</span></div><pre>'+esc(preview)+'</pre></div>';
    setApplyEnabled(true);
  }

  document.getElementById('apply').addEventListener('click', () => {
    if (!selected) return;
    vscode.postMessage({ type:'apply', id:selected.id, name:selected.name, year:yearEl.value, fullname:fullnameEl.value });
  });
  document.getElementById('openText').addEventListener('click', () => vscode.postMessage({type:'openText'}));
  yearEl.addEventListener('input', renderContent);
  fullnameEl.addEventListener('input', renderContent);

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'loading') {
      showStatus('Loading licenses from GitHub…', false);
      return;
    }
    if (msg.type === 'error') {
      showStatus(msg.message || 'Could not load licenses.', true);
      return;
    }
    if (msg.type !== 'state') return;
    licenses = msg.licenses || [];
    if (!licenses.length) {
      showStatus('No licenses were returned from GitHub.', true);
      return;
    }
    if (!selected || !licenses.some(l => l.id === selected.id)) selected = licenses[0];
    renderList(); renderContent();
  });
  vscode.postMessage({type:'ready'});
</script>
</body>
</html>`;
  }
}

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i++) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}

function deactivate() {}
module.exports = { activate, deactivate };
