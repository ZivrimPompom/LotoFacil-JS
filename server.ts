import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import AdmZip from "adm-zip";
import * as XLSX from "xlsx";

const app = express();

app.use(express.json());

// API to fetch results from Caixa
app.get("/api/sync-caixa", async (req, res) => {
  console.log("Request received for /api/sync-caixa");
  const urls = [
    "https://www.loterias.com.br/zip/lotofacil.zip",
    "https://loteriascaixa.gov.br/loterias/lotofacil/download/resultados/lotofacil.zip",
    "https://www.asloterias.com.br/download_excel?l=lotofacil",
    "https://www.loteriaserstats.com.br/download/lotofacil.zip",
    "https://www.ojogodobicho.com/arquivos/lotofacil.zip",
    "https://confiraloterias.com.br/download/lotofacil.zip",
    "https://www.asloterias.com.br/arquivos/lotofacil.zip",
    "https://investeloto.com.br/download/lotofacil.zip",
    "https://servicebus2.caixa.gov.br/loterias/arquivos/lotofacil/d_lotfac.zip",
    "https://loterias.caixa.gov.br/arquivos/lotofacil/d_lotfac.zip",
  ];

  let lastError: any = null;
  const startTime = Date.now();
  const VERCEL_TIMEOUT = 25000; // Total budget for all attempts (stay under 30s)

  for (const url of urls) {
    if (Date.now() - startTime > VERCEL_TIMEOUT) {
      console.warn("Approaching timeout, skipping remaining URLs");
      break;
    }

    try {
      console.log(`Trying URL: ${url}`);
      
      const response = await axios.get(url, { 
        responseType: "arraybuffer",
        timeout: 10000, 
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Referer": "https://loterias.caixa.gov.br/",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache"
        },
        timeout: 8000, 
        maxContentLength: 20 * 1024 * 1024,
      });

      if (response.status === 200 && response.data) {
        const pkHeader = response.data.length > 4 && response.data[0] === 0x50 && response.data[1] === 0x4B;

        if (pkHeader) {
          const zip = new AdmZip(Buffer.from(response.data));
          const zipEntries = zip.getEntries();
          
          const dataEntry = zipEntries.find(entry => 
            (entry.entryName.toLowerCase().includes("lotofacil") || 
             entry.entryName.toLowerCase().includes("resultado") || 
             entry.entryName.toLowerCase().includes("facil")) && 
            (entry.entryName.toLowerCase().endsWith(".htm") || 
             entry.entryName.toLowerCase().endsWith(".html") || 
             entry.entryName.toLowerCase().endsWith(".xlsx") || 
             entry.entryName.toLowerCase().endsWith(".xls") || 
             entry.entryName.toLowerCase().endsWith(".csv"))
          );

          if (!dataEntry) continue;

          const buffer = dataEntry.getData();
          let workbook;
          try {
              workbook = XLSX.read(buffer, { type: "buffer" });
          } catch (readError) {
              workbook = XLSX.read(buffer.toString(), { type: "string" });
          }

          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

          return res.json({ data: jsonData.slice(0, 10000), fileName: dataEntry.entryName });
        } else {
          // Direct file?
          try {
            const workbook = XLSX.read(response.data, { type: "buffer" });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            return res.json({ data: jsonData.slice(0, 10000), fileName: "direct_download" });
          } catch (e) {
            continue;
          }
        }
      }
    } catch (error: any) {
      console.warn(`Failed to fetch from ${url}:`, error.message);
      lastError = error;
    }
  }

  return res.status(502).json({ 
    error: "Falha ao sincronizar com a Caixa.",
    details: lastError?.message || "O site da Caixa pode estar offline ou bloqueando a requisição.",
    timeout: Date.now() - startTime > VERCEL_TIMEOUT
  });
});

async function configureApp() {
  const PORT = 3000;

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    
    // API 404 - Ensure other API calls don't fall through to index.html
    app.all("/api/*", (req, res) => {
      res.status(404).json({ error: "API route not found" });
    });

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
