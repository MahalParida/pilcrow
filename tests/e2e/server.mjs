import { createServer } from 'node:http';
createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Pilcrow editor test</title>
  <style>body{font:20px system-ui;max-width:850px;margin:64px auto;background:#f8f8f5;color:#23332e}label{display:block;margin:24px 0 8px}input,textarea,[contenteditable]{font:20px/1.7 system-ui;box-sizing:border-box;padding:20px;width:100%;border:1px solid #bbc8c1;border-radius:10px;background:white}textarea,[contenteditable]{min-height:170px}small{color:#52645b}</style>
  <h1>¶ Pilcrow · editor walkthrough</h1><p>Real extension UI. Simulated spelling responses for repeatable tests.</p>
  <label for="draft">Draft</label><textarea id="draft"></textarea>
  <label for="subject">Subject</label><input id="subject">
  <label for="rich">Rich text</label><div id="rich" contenteditable="true" role="textbox" aria-label="Rich text"></div>
  <label for="password">Password (excluded)</label><input id="password" type="password">
  </html>`);
}).listen(4173, '127.0.0.1');
