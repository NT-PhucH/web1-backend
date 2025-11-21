const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
require("dotenv").config();

// 1. Import Lịch học (Đường dẫn đúng là ./Services/...)
const {
  fetchSchedule,
  fetchStudentName,
} = require("./Services/scheduleScraper");

// 2. Import Điểm thi (Bạn đang thiếu dòng này, cần thêm vào để API /api/grades hoạt động)
// Lưu ý: Nếu bạn chưa tạo file gradeScraper.js thì dòng này sẽ lỗi, hãy chắc chắn file đó tồn tại trong folder Services
const { fetchStudentGrades } = require("./Services/gradeScraper");

const app = express();

app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());

// ==========================================
// 1. CẤU HÌNH BROWSER (Dùng chung cho cả app)
// ==========================================
async function initBrowser(headlessOverride = true) {
  console.log("Đang khởi động Browser...");

  const isProd = process.env.NODE_ENV === "production";
  // Nếu là Production thì luôn Headless
  // Nếu là Dev:
  // - Lấy lịch (Form cũ) -> Headless true (cho nhanh)
  // - Lấy điểm (SSO) -> Headless false (để nhập tay)
  const finalHeadless = isProd ? true : headlessOverride;

  return await puppeteer.launch({
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--single-process",
      "--no-zygote",
    ],
    headless: finalHeadless ? "new" : false,
    executablePath:
      process.env.NODE_ENV === "production"
        ? process.env.PUPPETEER_EXECUTABLE_PATH
        : puppeteer.executablePath(),
  });
}

// ==========================================
// 2. ROUTES API
// ==========================================

app.get("/", (req, res) => {
  res.send("Server API đang hoạt động!");
});

// --- API LẤY LỊCH HỌC (Nguồn: QLDT Form cũ) ---
app.post("/api/schedule", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ success: false, message: "Thiếu thông tin" });

  console.log(`[SCHEDULE] Đang xử lý cho ${username}...`);
  let browser;

  try {
    // Lấy lịch thì chạy headless (ẩn browser) cho nhanh
    browser = await initBrowser(true);

    // Gọi hàm từ file riêng
    const scheduleData = await fetchSchedule(browser, username, password);

    await browser.close();
    return res.json({ success: true, data: scheduleData });
  } catch (err) {
    console.error("[ERROR SCHEDULE]", err);
    if (browser) await browser.close();
    return res.json({ success: false, message: "Lỗi: " + err.message });
  }
});

// --- API LOGIN KIỂM TRA (Nguồn: QLDT Form cũ) ---
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ success: false, message: "Thiếu thông tin" });

  let browser;
  try {
    browser = await initBrowser(true);

    // Gọi hàm lấy tên từ file riêng
    const studentName = await fetchStudentName(browser, username, password);

    await browser.close();
    return res.json({ success: true, message: "Thành công", studentName });
  } catch (err) {
    if (browser) await browser.close();
    return res.json({ success: false, message: err.message });
  }
});

// --- API LẤY ĐIỂM THI (Nguồn: KTDBCL Microsoft SSO) ---
app.post("/api/grades", async (req, res) => {
  // Không bắt buộc phải có user/pass từ body nữa
  const { username, password } = req.body;

  console.log(`[GRADES] Yêu cầu mở trình duyệt lấy điểm...`);

  let browser;
  const headless = process.env.NODE_ENV === "production";

  try {
    browser = await initBrowser(headless);

    // Truyền user/pass (nếu có) hoặc undefined (nếu không có)
    const gradesData = await fetchStudentGrades(browser, username, password);

    await browser.close();
    return res.json({ success: true, data: gradesData });
  } catch (err) {
    console.error("[ERROR GRADES]", err);
    if (browser) await browser.close();
    return res.json({ success: false, message: "Lỗi: " + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
