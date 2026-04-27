import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import AdmZip from "adm-zip";
import * as XLSX from "xlsx";

const app = express();

async function configureApp() {
  const PORT = 3000;

  // API to fetch results from Caixa
  app.get("/api/sync-caixa", async (req, res) => {
    const urls = [
      "https://servicebus2.caixa.gov.br/loterias/arquivos/lotofacil/d_lotfac.zip",
      "https://www.asloterias.com.br/arquivos/lotofacil.zip",
      "https://loterias.caixa.gov.br/arquivos/lotofacil/d_lotfac.zip",
      "https://www.loterias.caixa.gov.br/arquivos/lotofacil/D_LOTFAC.ZIP"
    ];

    let lastError = null;

    for (const url of urls) {
      try {
        console.log("Attempting to fetch results from:", url);
        
        const response = await axios.get(url, {
          responseType: "arraybuffer",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://loterias.caixa.gov.br/Paginas/Lotofacil.aspx",
            "Accept": "application/zip, application/octet-stream, */*"
          },
          timeout: 30000 
        });

        if (response.status === 200) {
          const zip = new AdmZip(Buffer.from(response.data));
          const zipEntries = zip.getEntries();
          
          console.log("Zip entries found:", zipEntries.map(e => e.entryName));

          const dataEntry = zipEntries.find(entry => 
            (entry.entryName.toLowerCase().includes("lotofacil") || 
             entry.entryName.toLowerCase().includes("resultado") || 
             entry.entryName.toLowerCase().includes("facil")) && 
            (entry.entryName.toLowerCase().endsWith(".htm") || 
             entry.entryName.toLowerCase().endsWith(".html") || 
             entry.entryName.toLowerCase().endsWith(".xlsx") ||
             entry.entryName.toLowerCase().endsWith(".xls") ||
             entry.entryName.toLowerCase().endsWith(".css") ||
             entry.entryName.toLowerCase().endsWith(".csv"))
          );

          if (!dataEntry) {
            console.warn(`No recognized data file found in zip from ${url}`);
            continue;
          }

          console.log("Found data entry:", dataEntry.entryName);
          const buffer = dataEntry.getData();
          
          let workbook;
          try {
              workbook = XLSX.read(buffer, { type: "buffer" });
          } catch (readError) {
              console.error("XLSX.read error, trying alternative approach...");
              workbook = XLSX.read(buffer.toString(), { type: "string" });
          }

          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

          return res.json({ data: jsonData.slice(0, 10000), fileName: dataEntry.entryName });
        }
      } catch (error: any) {
        console.warn(`Failed to fetch from ${url}:`, error.message);
        lastError = error;
      }
    }

    res.status(502).json({ 
      error: "Falha ao sincronizar com a Caixa.",
      details: lastError?.message || "O site da Caixa pode estar offline ou bloqueando a requisição."
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

configureApp();

export default app;
