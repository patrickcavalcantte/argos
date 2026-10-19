// Gerador mínimo de .xlsx (sem dependências): uma planilha, cabeçalho em negrito e hiperlinks reais
const zlib = require('zlib');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const coluna = (n) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

function zip(arquivos) {
  const partes = [], central = [];
  let pos = 0;
  for (const [nome, conteudo] of arquivos) {
    const nomeB = Buffer.from(nome), dados = Buffer.from(conteudo), comp = zlib.deflateRawSync(dados);
    const crc = zlib.crc32(dados);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(dados.length, 22); h.writeUInt16LE(nomeB.length, 26);
    partes.push(h, nomeB, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(dados.length, 24); c.writeUInt16LE(nomeB.length, 28); c.writeUInt32LE(pos, 42);
    central.push(c, nomeB);
    pos += 30 + nomeB.length + comp.length;
  }
  const cd = Buffer.concat(central), fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...partes, cd, fim]);
}

// cabecalho: [string]; linhas: [[valor]]; colLink: índice da coluna cujo valor vira hiperlink; larguras: [número]
function gerarXlsx(cabecalho, linhas, colLink, larguras) {
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

module.exports = { gerarXlsx };
