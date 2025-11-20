const puppeteer = require("puppeteer");

// URL cấu hình
const LOGIN_URL = "https://ktdbcl.actvn.edu.vn/dang-nhap.html";
const GRADES_URL =
  "https://ktdbcl.actvn.edu.vn/khao-thi/hvsv/xem-diem-thi.html";

/**
 * Hàm hỗ trợ: Dừng chờ (sleep)
 */
const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));

/**
 * Hàm chính: Scrape điểm thi
 * @param {puppeteer.Browser} browser - Trình duyệt đã được khởi tạo từ server.js
 */
async function fetchStudentGrades(browser) {
  const page = await browser.newPage();

  // Set User Agent để giống người thật
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );

  console.log("[SCRAPER] Đang mở trang đăng nhập...");

  try {
    // 1. Vào trang đăng nhập
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });

    // --- XỬ LÝ ĐĂNG NHẬP MICROSOFT ---
    console.log(
      "-------------------------------------------------------------"
    );
    console.log("⚠️  VUI LÒNG ĐĂNG NHẬP MICROSOFT BẰNG TAY TRÊN TRÌNH DUYỆT!");
    console.log("👉  Code sẽ tự động chờ cho đến khi bạn đăng nhập xong.");
    console.log(
      "-------------------------------------------------------------"
    );

    // Tìm nút "Sign in with Microsoft" và click giúp người dùng (nếu có)
    try {
      // Selector này có thể thay đổi tùy web trường, đây là đoán class thường gặp
      // Nếu không click được thì bạn tự click tay cũng không sao
      const btnMicrosoft = await page.$("a[href*='login.microsoftonline.com']");
      if (btnMicrosoft) {
        await btnMicrosoft.click();
      }
    } catch (e) {
      // Bỏ qua lỗi này, người dùng tự click
    }

    // QUAN TRỌNG: Chờ cho đến khi URL không còn chứa chữ "dang-nhap" hoặc "login"
    // Nghĩa là đã login xong và chuyển hướng về trang chủ hoặc dashboard
    await page.waitForFunction(
      () =>
        !window.location.href.includes("login") &&
        !window.location.href.includes("dang-nhap"),
      { timeout: 0 } // 0 nghĩa là chờ vô hạn (đến khi bạn nhập xong pass)
    );

    console.log(
      "[SCRAPER] Đã phát hiện đăng nhập thành công! Đang chuyển đến trang điểm..."
    );

    // 2. Vào trang xem điểm
    await page.goto(GRADES_URL, { waitUntil: "networkidle2", timeout: 60000 });

    // Chờ bảng điểm xuất hiện
    await page.waitForSelector("table", { timeout: 30000 });

    // 3. Bóc tách dữ liệu (Scraping)
    const gradesData = await page.evaluate(() => {
      const data = [];
      const tables = document.querySelectorAll("table");

      // Giả sử bảng điểm là bảng đầu tiên hoặc bảng có nhiều dòng nhất
      // Bạn có thể cần inspect kỹ hơn để chọn đúng bảng nếu có nhiều bảng
      const table = tables[0];
      if (!table) return [];

      const rows = Array.from(table.querySelectorAll("tr"));

      // Bỏ qua dòng tiêu đề (thường là dòng đầu tiên)
      // Bắt đầu từ dòng số 1 (index 1)
      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].querySelectorAll("td");
        if (cells.length < 8) continue; // Bỏ qua dòng không đủ dữ liệu

        // HÀM HỖ TRỢ: Lấy text và xử lý số liệu (đổi dấu phẩy thành chấm)
        const getText = (index) => cells[index]?.innerText.trim() || "";
        const getNum = (index) => {
          const txt = getText(index);
          return txt ? parseFloat(txt.replace(",", ".")) : 0;
        };

        // --- QUAN TRỌNG: MAPPING CỘT (CẦN KIỂM TRA LẠI VỚI WEBSITE THỰC TẾ) ---
        // Dựa vào ảnh bạn gửi:
        // #, Năm học, Học kỳ, Môn thi, Lần, TP1, TP2, ĐQT, Điểm thi, Điểm HP, Điểm chữ
        // 0     1        2       3      4    5    6    7       8         9        10

        // Lưu ý: Trong ảnh KHÔNG THẤY CỘT TÍN CHỈ (TC).
        // Nếu website trường bạn không hiện cột tín chỉ ở bảng này,
        // ta sẽ phải gán cứng hoặc tìm cách khác. Tạm thời tôi để mặc định là 2 hoặc 3.

        const subjectName = getText(3);
        if (!subjectName) continue;

        data.push({
          subjectName: subjectName,
          credits: 3, // <--- LƯU Ý: Cần tìm cột Tín chỉ. Nếu không có, tạm để 3.
          midtermScore: getNum(5), // TP1
          attendanceScore: getNum(6), // TP2
          finalScore: getNum(8), // Điểm thi
          totalScore: getNum(9), // Điểm HP
          gradeLetter: getText(10), // Điểm chữ
        });
      }
      return data;
    });

    console.log(`[SCRAPER] Đã lấy được ${gradesData.length} môn học.`);

    // Đóng tab này (không đóng browser để server còn chạy)
    await page.close();

    return gradesData;
  } catch (error) {
    console.error("[SCRAPER ERROR]", error);
    await page.close();
    throw new Error("Lỗi khi lấy điểm: " + error.message);
  }
}

module.exports = { fetchStudentGrades };
