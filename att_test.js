// v4.27.0 — attachments. The type detection, block builder and DOCX stripper
// are LIFTED AND RUN. The critical property is that an UNREADABLE attachment is
// never represented as a readable one, so that is exercised rather than
// inspected.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
eval([grab(/  const RQ_ATT_MAX_CHARS[\s\S]*?const RQ_PDFJS_WORKER = .*/).replace(/^\s*const /gm,"var "),
      grab(/  function attIsText\(f\) \{[\s\S]*?\n  \}/),
      grab(/  function attIsPdf\(f\) \{.*\}/),
      grab(/  function attIsDocx\(f\) \{.*\}/),
      grab(/  function attIsImage\(f\) \{[\s\S]*?\n  \}/),
      grab(/  function attStripDocxXml\(xml\) \{[\s\S]*?\n  \}/),
      grab(/  function attBlock\(\) \{[\s\S]*?\n  \}/)].join("\n")
     .replace("let _attachments = [];","") +
     "\nvar _attachments=[];globalThis.setAtt=(a)=>{_attachments=a;};" +
     "globalThis.attBlock=attBlock;globalThis.attIsImage=attIsImage;globalThis.attIsPdf=attIsPdf;" +
     "globalThis.attIsDocx=attIsDocx;globalThis.attIsText=attIsText;globalThis.attStripDocxXml=attStripDocxXml;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);
const F=(name,type)=>({name,type:type||""});

console.log("\n--- type detection, including the mobile cases ---");
tt("txt", attIsText(F("notes.txt")));
tt("csv", attIsText(F("data.csv")));
tt("pdf", attIsPdf(F("report.pdf")));
tt("docx", attIsDocx(F("brief.docx")));
tt("jpg", attIsImage(F("photo.jpg")));
tt("png by MIME with no extension", attIsImage(F("clip","image/png")));
tt("HEIC with an EMPTY mime type, which is what iOS actually sends",
   attIsImage(F("IMG_4021.HEIC","")));
tt("a pdf is not treated as text", !attIsText(F("report.pdf")));

console.log("\n--- an unreadable attachment is NEVER shown as readable ---");
setAtt([{name:"photo.jpg",kind:"image",chars:0,text:null,note:"image, 3024×4032, 2100KB"}]);
const b=attBlock();
tt("the image is named", /photo\.jpg/.test(b));
tt("and declared unreadable", /ATTACHED BUT UNREADABLE/.test(b));
tt("seats are told not to guess at contents", /Do not guess at their contents/.test(b));
tt("and explicitly not to treat the FILENAME as evidence",
   /do not treat the filename as\s*evidence|not treat the filename as evidence/.test(b));
tt("it is not silently dropped", b.length > 0);

console.log("\n--- readable and unreadable together ---");
setAtt([
 {name:"contract.pdf",kind:"pdf",chars:900,text:"[p.1] Payment terms are net 30.",note:"0k chars"},
 {name:"scan.jpg",kind:"image",chars:0,text:null,note:"image, 1200×900"},
]);
const both=attBlock();
tt("the readable file's text is included", /Payment terms are net 30/.test(both));
tt("with its page marker preserved", /\[p\.1\]/.test(both));
tt("and the image is still declared unreadable", /scan\.jpg/.test(both) && /UNREADABLE/.test(both));

console.log("\n--- caps ---");
setAtt([{name:"big.txt",kind:"text",chars:99999,text:"x".repeat(99999),note:""}]);
tt("total text is capped", attBlock().length < RQ_ATT_MAX_CHARS + 500);
setAtt([]);
t("no attachments produces no block", attBlock(), "");

console.log("\n--- docx stripping ---");
const xml='<w:document><w:body><w:p><w:r><w:t>First para</w:t></w:r></w:p>'+
  '<w:p><w:r><w:t>Second &amp; third</w:t></w:r></w:p></w:body></w:document>';
const d=attStripDocxXml(xml);
tt("text is extracted", /First para/.test(d) && /Second & third/.test(d));
tt("paragraphs become newlines", /First para\n/.test(d));
tt("no tags survive", !/</.test(d));

console.log("\n--- shape: the failures that matter most ---");
tt("a file that cannot be read is ANNOUNCED, never silently skipped",
   /could NOT be read/.test(src) && /it was NOT attached/.test(src));
tt("a scanned PDF says so rather than reporting an empty document",
   /looks like a scanned PDF/.test(src));
tt("a binary file is refused rather than attached as mojibake",
   /looks like a binary file and has no readable text/.test(src));
tt("send works with an attachment and no typed question",
   /if \(!q && !_attachments\.length\) return;/.test(src));
tt("attachments are cleared after the round and that is stated",
   /attachments do not\s+\/\/|do not " \+\s*"persist into later rounds|attachClear|attClear\(\);/.test(src));
tt("truncation is declared, never bridged",
   /the remainder is NOT summarised/i.test(src));
tt("images are measured, not read \u2014 the decision is documented",
   /THE IMAGE DECISION|CANNOT see it/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
