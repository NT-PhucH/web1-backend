const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");

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
// 1. CẤU HÌNH
// ==========================================
async function initBrowser() {
  return await puppeteer.launch({
    headless: false,
    ignoreHTTPSErrors: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--ignore-certificate-errors",
      "--allow-running-insecure-content",
      "--disable-web-security",
      "--window-size=1366,768",
      "--unsafely-treat-insecure-origin-as-secure=http://qldt.actvn.edu.vn",
      "--disable-features=SafeBrowsing,NetworkService",
      "--disable-client-side-phishing-detection",
    ],
    defaultViewport: null,
  });
}

// ==========================================
// 2. LOGIN
// ==========================================
async function performLogin(page, username, password) {
  page.on("dialog", async (dialog) => await dialog.accept());

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );

  try {
    await page.goto("http://qldt.actvn.edu.vn/CMCSoft.IU.Web.info/Login.aspx", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  } catch (e) {
    if (!page.url().includes("Login.aspx"))
      await page.reload({ waitUntil: "domcontentloaded" });
  }

  try {
    const title = await page.title();
    if (title.includes("Privacy") || title.includes("Bảo mật")) {
      await page.keyboard.type("thisisunsafe");
      await delay(1500);
    }
  } catch (e) {}

  try {
    await page.waitForSelector("#txtUserName", { timeout: 8000 });
  } catch (e) {
    throw new Error("Lỗi tải trang login.");
  }

  await page.type("#txtUserName", username, { delay: 20 });
  await page.type("#txtPassword", password, { delay: 20 });

  const loginBtn = await page.$("#btnSubmit");
  if (loginBtn) {
    await Promise.all([
      loginBtn.click(),
      delay(2000),
      page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 })
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
    return res.json({ success: false, message: err.message });
  }
});

// ==========================================
// 3. API LẤY LỊCH (PARSER MỚI CHO TRANG REPORT)
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

    // Vào thẳng trang Report (Link dự phòng ổn định nhất)
    console.log("--> Vào trang Report TKB...");
    await page.goto(
      "http://qldt.actvn.edu.vn/CMCSoft.IU.Web.info/Reports/Form/StudentTimeTable.aspx",
      { waitUntil: "networkidle2", timeout: 45000 }
    );

    try {
      await page.waitForSelector("table", { timeout: 8000 });
    } catch (e) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("table", { timeout: 8000 });
    }

    // LOGIC PARSE DỮ LIỆU PHỨC TẠP
    const scheduleData = await page.evaluate(() => {
      // 1. Tìm đúng bảng chứa dữ liệu (Bảng có chữ "Lớp học phần" hoặc "Giảng viên")
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

      // Hàm hỗ trợ parse ngày tháng
      function parseDateStr(str) {
        if (!str) return null;
        const parts = str.split("/");
        if (parts.length === 3)
          return new Date(parts[2], parts[1] - 1, parts[0]);
        return null;
      }

      // Hàm format lại ngày thành dd/mm/yyyy
      function formatDate(date) {
        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, "0");
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
      }

      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        // Dựa vào log: Cột 1=Tên, Cột 3=Thời gian, Cột 4=Địa điểm, Cột 5=GV
        if (cells.length < 5) return;
        const rowText = row.innerText.trim();
        if (rowText.startsWith("STT") || rowText.includes("Tổng")) return;

        const name = cells[1]?.innerText.trim();
        const timeCell = cells[3]?.innerText.trim(); // Chuỗi phức tạp
        const room = cells[4]?.innerText.trim();
        const teacher = cells[5]?.innerText.trim();

        if (!timeCell) return;

        // Xử lý chuỗi thời gian: "Từ 27/10/2025 đến 16/11/2025: (1) Thứ 2 tiết 7,8,9 (LT)"
        // Có thể có nhiều dòng trong 1 ô
        const lines = timeCell.split("\n");
        let currentStartDate = null;
        let currentEndDate = null;

        lines.forEach((line) => {
          line = line.trim();

          // Case 1: Dòng chứa khoảng thời gian "Từ ... đến ..."
          const dateRangeMatch = line.match(
            /Từ (\d{1,2}\/\d{1,2}\/\d{4}) đến (\d{1,2}\/\d{1,2}\/\d{4})/
          );
          if (dateRangeMatch) {
            currentStartDate = parseDateStr(dateRangeMatch[1]);
            currentEndDate = parseDateStr(dateRangeMatch[2]);
          }

          // Case 2: Dòng chứa thứ và tiết "Thứ 2 tiết 7,8,9"
          // Lưu ý: Nếu dòng này đi kèm với khoảng thời gian ở trên thì mới xử lý
          const sessionMatch = line.match(/Thứ (\d+|CN) tiết ([\d,]+)/);

          if (currentStartDate && currentEndDate && sessionMatch) {
            const thuStr = sessionMatch[1]; // 2, 3, 4... hoặc CN
            const tietHoc = sessionMatch[2]; // 7,8,9

            // Map thứ sang số của JS (CN=0, T2=1, ...)
            let targetDay = -1;
            if (thuStr === "CN") targetDay = 0;
            else targetDay = parseInt(thuStr) - 1;

            // Duyệt từ ngày bắt đầu đến ngày kết thúc
            // Tạo ra các buổi học cụ thể
            let iterDate = new Date(currentStartDate);
            while (iterDate <= currentEndDate) {
              if (iterDate.getDay() === targetDay) {
                data.push({
                  ngayHoc: formatDate(iterDate), // Ngày cụ thể dd/mm/yyyy
                  caHoc: tietHoc, // Ví dụ: 7,8,9 -> Code JS sẽ tự map
                  tenMonHoc: name,
                  phongHoc: room,
                  giangVien: teacher,
                });
              }
              // Cộng thêm 1 ngày
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

    // Debug: In thử 1 dòng
    if (scheduleData.length > 0) console.log("Ví dụ:", scheduleData[0]);

    await browser.close();
    return res.json({ success: true, data: scheduleData });
  } catch (err) {
    console.error("[ERROR]", err);
    if (browser) await browser.close();
    return res.json({ success: false, message: "Lỗi: " + err.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Backend Parser Report chạy tại: http://localhost:${PORT}`);
});
