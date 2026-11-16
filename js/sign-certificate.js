// E-signatures: shared helpers. SHA-256 fingerprints of files, and the "signed copy": the original PDF with a signing
// certificate page added (pdf-lib, loaded only when needed). Used by js/signatures.js (staff) and js/my-signatures.js (My portal).

(function () {
  const PDF_LIB = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";

  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function fetchDocument(path) {
    const { data, error } = await supabaseClient.storage.from("signature-documents").createSignedUrl(path, 300);
    if (error || !data) throw new Error("The document could not be opened.");
    const res = await fetch(data.signedUrl);
    if (!res.ok) throw new Error("The document could not be downloaded.");
    const bytes = await res.arrayBuffer();
    return { bytes, hash: await sha256Hex(bytes), url: data.signedUrl };
  }

  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PDF_LIB; s.onload = () => resolve(window.PDFLib); s.onerror = () => reject(new Error("The PDF tool did not load. Check the internet connection."));
      document.head.appendChild(s);
    });
  }

  const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "America/Jamaica", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " (Jamaica time)" : "");
  // pdf-lib's standard fonts only cover basic Latin characters.
  const plain = (v) => String(v ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "?");

  // info: { title, company, fileHash, documentName, sentBy, sentAt, signers: [{ name_on_file, signed_name, status, signed_at, ip_address, user_agent, signature_image, decline_reason, viewed_at }] }
  async function buildSignedCopy(originalBytes, info) {
    const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
    const pdf = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const ink = rgb(0.09, 0.09, 0.18), muted = rgb(0.38, 0.39, 0.46), line = rgb(0.85, 0.86, 0.9);
    let page = pdf.addPage([595.28, 841.89]);
    let y = 790;
    const text = (t, size, f, color, x) => { page.drawText(plain(t), { x: x || 50, y, size, font: f || font, color: color || ink, maxWidth: 495 }); y -= size + 6; };
    const wrap = (t, size, f, color) => {
      const words = plain(t).split(/\s+/); let lineText = "";
      words.forEach((w) => { const next = lineText ? `${lineText} ${w}` : w; if ((f || font).widthOfTextAtSize(next, size) > 495) { text(lineText, size, f, color); lineText = w; } else lineText = next; });
      if (lineText) text(lineText, size, f, color);
    };
    const newPageIfNeeded = (need) => { if (y - need < 60) { page = pdf.addPage([595.28, 841.89]); y = 790; } };

    text("Electronic signature certificate", 20, bold);
    y -= 4;
    wrap(`This page was added by Kairox Pay to "${info.title}" (${info.documentName}) for ${info.company || "the employer"}.`, 10, font, muted);
    y -= 6;
    text("Document fingerprint (SHA-256)", 10, bold);
    text(info.fileHash, 9, font, muted);
    wrap("Each person below signed the file with exactly this fingerprint. Any change to the document, even one character, gives a different fingerprint.", 9, font, muted);
    text(`Sent by ${info.sentBy || "-"} on ${when(info.sentAt)}`, 9, font, muted);
    y -= 10;

    for (const s of info.signers) {
      newPageIfNeeded(170);
      page.drawLine({ start: { x: 50, y: y + 6 }, end: { x: 545, y: y + 6 }, thickness: 1, color: line });
      y -= 8;
      text(s.name_on_file, 13, bold);
      if (s.status === "signed") {
        text(`Signed as: ${s.signed_name}`, 10);
        text(`Signed on: ${when(s.signed_at)}`, 10);
        if (s.viewed_at) text(`First opened: ${when(s.viewed_at)}`, 9, font, muted);
        if (s.ip_address) text(`Internet address: ${s.ip_address}`, 9, font, muted);
        if (s.user_agent) wrap(`Browser: ${s.user_agent}`, 8, font, muted);
        text("Agreed to sign electronically, after opening the document.", 9, font, muted);
        if (s.signature_image && /^data:image\/png;base64,/.test(s.signature_image)) {
          try {
            const png = await pdf.embedPng(s.signature_image);
            const scale = Math.min(200 / png.width, 60 / png.height, 1);
            newPageIfNeeded(70);
            page.drawImage(png, { x: 50, y: y - png.height * scale + 10, width: png.width * scale, height: png.height * scale });
            y -= png.height * scale + 6;
          } catch (e) { /* a damaged drawing is left out; the typed name still stands */ }
        }
      } else if (s.status === "declined") {
        text("Declined to sign", 10, bold, rgb(0.7, 0.1, 0.1));
        if (s.decline_reason) wrap(`Reason: ${s.decline_reason}`, 9, font, muted);
      } else {
        text("Not signed yet", 10, bold, rgb(0.7, 0.45, 0.05));
      }
      y -= 8;
    }
    newPageIfNeeded(40);
    wrap(`Certificate made ${when(new Date().toISOString())}. Signed electronically through Kairox Pay.`, 8, font, muted);
    return pdf.save();
  }

  function saveBytes(bytes, name) {
    const blob = new Blob([bytes], { type: "application/pdf" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  window.KxSign = { sha256Hex, fetchDocument, buildSignedCopy, saveBytes, when };
})();
