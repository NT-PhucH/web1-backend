const express = require("express");
const cors = require("cors");

// THAY ĐỔI 1: Import thư viện mới cho Render
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());

const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));

// ==========================================
// 1. CẤU HÌNH (INIT BROWSER ĐÃ SỬA)
// ==========================================
async function initBrowser() {
  // THAY ĐỔI 2: Cấu hình launch cho môi trường Serverless/Render
  return await puppeteer.launch({
    args: [
      ...chromium.args, // Sử dụng các args tối ưu của chromium
      "--hide-scrollbars",
      "--disable-web-security",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(), // Đường dẫn đến Chromium đã nén
    headless: chromium.headless, // Luôn là true trên server
    ignoreHTTPSErrors: true,
  });
}

// ==========================================
// 2. LOGIN
// ==========================================
async function performLogin(page, username, password) {
  page.on("dialog", async (dialog) => await dialog.accept());

  // Giả lập user agent để tránh bị chặn
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );

  try {
    await page.goto("http://qldt.actvn.edu.vn/CMCSoft.IU.Web.info/Login.aspx", {
      waitUntil: "domcontentloaded",
      timeout: 60000, // Tăng timeout lên để an toàn hơn trên server
    });
  } catch (e) {
    if (!page.url().includes("Login.aspx"))
      await page.reload({ waitUntil: "domcontentloaded" });
  }

  try {
    // Bypass cảnh báo bảo mật (nếu có)
    const title = await page.title();
    if (title.includes("Privacy") || title.includes("Bảo mật")) {
      await page.keyboard.type("thisisunsafe");
      await delay(1500);
    }
  } catch (e) {}

  try {
    await page.waitForSelector("#txtUserName", { timeout: 10000 });
  } catch (e) {
    throw new Error("Lỗi tải trang login (Timeout).");
  }

  await page.type("#txtUserName", username, { delay: 20 });
  await page.type("#txtPassword", password, { delay: 20 });

  const loginBtn = await page.$("#btnSubmit");
  if (loginBtn) {
    await Promise.all([
      loginBtn.click(),
      delay(2000),
      page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 })
        .catch(() => {}),
    ]);
  }
  return true;
}

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ success: false, message: "Thiếu thông tin" });
  let browser;
  try {
    browser = await initBrowser();
    const page = await browser.newPage();
    await performLogin(page, username, password);
    const studentName = await page.evaluate(() => {
      const el =
        document.querySelector("#lblStudentName") ||
        document.querySelector(".user-name");
      return el ? el.innerText : "Sinh viên";
    });
    await browser.close();
    return res.json({ success: true, message: "Thành công", studentName });
  } catch (err) {
    if (browser) await browser.close();
    console.error(err);
    return res.json({ success: false, message: err.message });
  }
});

// ==========================================
// 3. API LẤY LỊCH
// ==========================================
app.post("/api/schedule", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ success: false, message: "Thiếu thông tin" });

  console.log(`[SCHEDULE] Đang xử lý cho ${username}...`);
  let browser;

  try {
    browser = await initBrowser();
    const page = await browser.newPage();

    await performLogin(page, username, password);

    console.log("--> Vào trang Report TKB...");
    await page.goto(
      "http://qldt.actvn.edu.vn/CMCSoft.IU.Web.info/Reports/Form/StudentTimeTable.aspx",
      { waitUntil: "networkidle2", timeout: 60000 } // Tăng timeout cho server
    );

    try {
      await page.waitForSelector("table", { timeout: 10000 });
    } catch (e) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("table", { timeout: 10000 });
    }

    const scheduleData = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll("table"));
      const table = tables.find(
        (t) =>
          t.innerText.includes("Lớp học phần") &&
          t.innerText.includes("Giảng viên") &&
          t.querySelectorAll("tr").length > 2
      );

      if (!table) return [];

      const rows = Array.from(table.querySelectorAll("tr"));
      const data = [];

      function parseDateStr(str) {
        if (!str) return null;
        const parts = str.split("/");
        if (parts.length === 3)
          return new Date(parts[2], parts[1] - 1, parts[0]);
        return null;
      }

      function formatDate(date) {
        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, "0");
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
      }

      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 5) return;
        const rowText = row.innerText.trim();
        if (rowText.startsWith("STT") || rowText.includes("Tổng")) return;

        const name = cells[1]?.innerText.trim();
        const timeCell = cells[3]?.innerText.trim();
        const room = cells[4]?.innerText.trim();
        const teacher = cells[5]?.innerText.trim();

        if (!timeCell) return;

        const lines = timeCell.split("\n");
        let currentStartDate = null;
        let currentEndDate = null;

        lines.forEach((line) => {
          line = line.trim();
          const dateRangeMatch = line.match(
            /Từ (\d{1,2}\/\d{1,2}\/\d{4}) đến (\d{1,2}\/\d{1,2}\/\d{4})/
          );
          if (dateRangeMatch) {
            currentStartDate = parseDateStr(dateRangeMatch[1]);
            currentEndDate = parseDateStr(dateRangeMatch[2]);
          }

          const sessionMatch = line.match(/Thứ (\d+|CN) tiết ([\d,]+)/);

          if (currentStartDate && currentEndDate && sessionMatch) {
            const thuStr = sessionMatch[1];
            const tietHoc = sessionMatch[2];

            let targetDay = -1;
            if (thuStr === "CN") targetDay = 0;
            else targetDay = parseInt(thuStr) - 1;

            let iterDate = new Date(currentStartDate);
            while (iterDate <= currentEndDate) {
              if (iterDate.getDay() === targetDay) {
                data.push({
                  ngayHoc: formatDate(iterDate),
                  caHoc: tietHoc,
                  tenMonHoc: name,
                  phongHoc: room,
                  giangVien: teacher,
                });
              }
              iterDate.setDate(iterDate.getDate() + 1);
            }
          }
        });
      });
      return data;
    });

    console.log(
      `[SCHEDULE] Đã tách thành công ${scheduleData.length} buổi học.`
    );

    await browser.close();
    return res.json({ success: true, data: scheduleData });
  } catch (err) {
    console.error("[ERROR]", err);
    if (browser) await browser.close();
    return res.json({ success: false, message: "Lỗi: " + err.message });
  }
});

// THAY ĐỔI 3: Sử dụng biến môi trường PORT của Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend Parser Report chạy tại port: ${PORT}`);
});
