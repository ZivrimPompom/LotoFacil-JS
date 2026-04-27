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
  
  // Primary sync URLs. We use a mix of official and reliable mirrors.
  const urls: string[] = [
    "https://loteriascaixa-api.herokuapp.com/api/lotofacil", // JSON API (Popular)
    "https://servicebus2.caixa.gov.br/loterias/arquivos/lotofacil/d_lotfac.zip", // Official
    "https://asloterias.com.br/arquivos/lotofacil.zip", // Mirrored ZIP
    "https://lotodicas.com.br/files/lotofacil.csv", // Mirror CSV
  ];

  let lastError: any = null;
  const startTime = Date.now();
  const VERCEL_TIMEOUT = 25000; 

  for (const url of urls) {
    if (Date.now() - startTime > VERCEL_TIMEOUT) break;

    try {
      console.log(`Trying URL: ${url}`);
      
      const response = await axios.get(url, { 
        responseType: "arraybuffer",
        timeout: 8000, 
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "*/*"
        },
        maxContentLength: 15 * 1024 * 1024,
      });

      if (response.status === 200 && response.data) {
        const body = response.data;
        const pkHeader = body.length > 4 && body[0] === 0x50 && body[1] === 0x4B;

        // 1. If it's a ZIP file
        if (pkHeader) {
          const zip = new AdmZip(Buffer.from(body));
          const zipEntries = zip.getEntries();
          const dataEntry = zipEntries.find(entry => 
            entry.entryName.toLowerCase().match(/\.(htm|html|xlsx|xls|csv)$/)
          );

          if (dataEntry) {
            const buffer = dataEntry.getData();
            const workbook = XLSX.read(buffer, { type: "buffer" });
            const sheetName = workbook.SheetNames[0];
            const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
            return res.json({ data: jsonData.slice(0, 10000), fileName: dataEntry.entryName });
          }
        } 
        
        // 2. If it's a JSON response (some APIs return JSON)
        try {
          const str = body.toString();
          if (str.trim().startsWith('[') || str.trim().startsWith('{')) {
            const parsed = JSON.parse(str);
            // If it's a list of results, transform to array-of-arrays expected by App.tsx
            if (Array.isArray(parsed)) {
              const rows = parsed.map((item: any) => {
                // Handle different JSON structures from various APIs
                if (item.dezenas && Array.isArray(item.dezenas)) {
                  return [item.concurso, ...item.dezenas.map(Number)];
                }
                return Object.values(item);
              });
              return res.json({ data: rows, fileName: "api_json_response" });
            }
          }
        } catch (e) { /* Not JSON, move on */ }

        // 3. Direct spreadsheet/CSV
        try {
          const workbook = XLSX.read(body, { type: "buffer" });
          const sheetName = workbook.SheetNames[0];
          const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
          if (jsonData.length > 0) {
            return res.json({ data: jsonData.slice(0, 10000), fileName: "direct_download" });
          }
        } catch (e) {
          // Fallback to text/CSV
          const str = body.toString();
          if (str.includes(',') || str.includes(';')) {
            const rows = str.split('\n').map(line => line.split(/[;,]/));
            if (rows.length > 5) return res.json({ data: rows, fileName: "direct_csv" });
          }
        }
      }
    } catch (error: any) {
      console.warn(`Failed URL ${url}:`, error.message);
      lastError = error;
    }
  }

  return res.status(200).json({ 
    error: "No momento a sincronização automática está instável.",
    details: "As fontes de dados costumam mudar ou bloquear o acesso. Por favor, tente novamente mais tarde ou carregue o arquivo (.xlsx, .zip ou .htm) clicando no botão 'LOCAL'.",
    timeout: Date.now() - startTime > VERCEL_TIMEOUT,
    manual_url: "https://loterias.caixa.gov.br/Paginas/Lotofacil.aspx"
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
