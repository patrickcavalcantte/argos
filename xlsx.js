// Gerador mínimo de .xlsx (sem dependências), usado no navegador e no Node 18+.
// Uma planilha, cabeçalho em negrito, filtro, linha congelada e hiperlinks reais.
// gerarXlsx(cabecalho, linhas, colLink, larguras) -> Promise<Uint8Array>
(function (raiz) {
  const enc = new TextEncoder();
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const coluna = (n) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

  const TABELA = new Uint32Array(256).map((_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = TABELA[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

  async function comprimir(bytes) {
    const fluxo = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(fluxo).arrayBuffer());
  }

  async function zip(arquivos) {
    const partes = [], central = [];
    let pos = 0;
    for (const [nome, conteudo] of arquivos) {
      const nomeB = enc.encode(nome), dados = enc.encode(conteudo), comp = await comprimir(dados), crc = crc32(dados);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 8, true);
      h.setUint32(14, crc, true); h.setUint32(18, comp.length, true); h.setUint32(22, dados.length, true); h.setUint16(26, nomeB.length, true);
      partes.push(new Uint8Array(h.buffer), nomeB, comp);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 8, true);
      c.setUint32(16, crc, true); c.setUint32(20, comp.length, true); c.setUint32(24, dados.length, true); c.setUint16(28, nomeB.length, true); c.setUint32(42, pos, true);
      central.push(new Uint8Array(c.buffer), nomeB);
      pos += 30 + nomeB.length + comp.length;
    }
    const tamCentral = central.reduce((t, p) => t + p.length, 0);
    const fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
    fim.setUint32(12, tamCentral, true); fim.setUint32(16, pos, true);
    const todas = [...partes, ...central, new Uint8Array(fim.buffer)];
    const saida = new Uint8Array(todas.reduce((t, p) => t + p.length, 0));
    let o = 0;
    for (const p of todas) { saida.set(p, o); o += p.length; }
    return saida;
  }

  // cabecalho: [string]; linhas: [[valor]]; colLink: índice da coluna cujo valor vira hiperlink; larguras: [número]
  async function gerarXlsx(cabecalho, linhas, colLink, larguras) {
    const links = [];
    const celula = (v, c, r) => {
      const ref = coluna(c) + r;
      if (c === colLink && /^https?:\/\//i.test(v)) { links.push([ref, String(v).slice(0, 2000)]); return `<c r="${ref}" t="inlineStr" s="2"><is><t>${esc(v)}</t></is></c>`; }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v ?? '').slice(0, 32000))}</t></is></c>`;
    };
    const cab = `<row r="1">${cabecalho.map((t, c) => `<c r="${coluna(c)}1" t="inlineStr" s="1"><is><t>${esc(t)}</t></is></c>`).join('')}</row>`;
    const corpo = linhas.map((l, i) => `<row r="${i + 2}">${l.map((v, c) => celula(v, c, i + 2)).join('')}</row>`).join('');
    const cols = larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const hl = links.length ? `<hyperlinks>${links.map(([ref], i) => `<hyperlink ref="${ref}" r:id="rId${i + 1}"/>`).join('')}</hyperlinks>` : '';
    const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const rel = (t) => 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + t;
    const arquivos = [
      ['[Content_Types].xml', H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', H + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel('officeDocument')}" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', H + `<workbook ${ns}><sheets><sheet name="Notícias" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', H + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel('worksheet')}" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel('styles')}" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', H + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>'],
      ['xl/worksheets/sheet1.xml', H + `<worksheet ${ns}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${cab}${corpo}</sheetData><autoFilter ref="A1:${coluna(cabecalho.length - 1)}${linhas.length + 1}"/>${hl}</worksheet>`],
    ];
    if (links.length) arquivos.push(['xl/worksheets/_rels/sheet1.xml.rels', H + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map(([, u], i) => `<Relationship Id="rId${i + 1}" Type="${rel('hyperlink')}" Target="${esc(u)}" TargetMode="External"/>`).join('')}</Relationships>`]);
    return zip(arquivos);
  }

  if (typeof module !== 'undefined') module.exports = { gerarXlsx };
  else raiz.gerarXlsx = gerarXlsx;
})(typeof self !== 'undefined' ? self : globalThis);
