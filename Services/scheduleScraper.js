const puppeteer = require("puppeteer");

const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));

/**
 * Hàm đăng nhập vào trang QLDT
 */
async function performLogin(page, username, password) {
  console.log("[SCRAPER] Đang thực hiện đăng nhập...");

  // 1. Xử lý dialog cảnh báo nếu có
  page.on("dialog", async (dialog) => await dialog.accept());

  // 2. Giả lập User Agent để tránh bị chặn và load nhanh hơn
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );

  try {
    // 3. Vào trang Login (Tăng timeout lên 60s)
    await page.goto("http://qldt.actvn.edu.vn/CMCSoft.IU.Web.info/Login.aspx", {
      waitUntil: "domcontentloaded", // Chỉ cần tải xong khung HTML là được, không cần chờ ảnh
      timeout: 60000,
    });
  } catch (e) {
    console.log("Lỗi tải trang login, thử reload...");
    if (!page.url().includes("Login.aspx"))
      await page.reload({ waitUntil: "domcontentloaded" });
  }

  // 4. Nhập User/Pass
  try {
    await page.waitForSelector("#txtUserName", { timeout: 20000 }); // Chờ ô nhập tối đa 20s
    await page.type("#txtUserName", username, { delay: 50 });
    await page.type("#txtPassword", password, { delay: 50 });
  } catch (e) {
    throw new Error("Không tìm thấy ô đăng nhập (Web trường quá lag).");
  }

  // 5. Click đăng nhập và CHỜ ĐIỀU HƯỚNG (Quan trọng)
  const loginBtn = await page.$("#btnSubmit");
  if (loginBtn) {
    await Promise.all([
      loginBtn.click(),
      // Chờ 60s cho việc chuyển trang
      page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 })
        .catch(() =>
          console.log("Hết thời gian chờ chuyển trang, nhưng vẫn thử tiếp...")
        ),
    ]);
  }

  // 6. Kiểm tra xem đã vào được chưa
  if (page.url().includes("Login.aspx")) {
    // Thử tìm thông báo lỗi
    const errorText = await page.evaluate(() => {
      const el = document.querySelector("#lblErrorInfo");
      return el ? el.innerText : "";
    });
    throw new Error(
      `Đăng nhập thất bại: ${errorText || "Sai mật khẩu hoặc lỗi hệ thống"}`
    );
  }

  console.log("[SCRAPER] Đăng nhập thành công!");
  return true;
}

/**
 * Hàm lấy tên sinh viên
 */
async function fetchStudentName(browser, username, password) {
  const page = await browser.newPage();
  try {
    await performLogin(page, username, password);

    const studentName = await page.evaluate(() => {
      const el =
        document.querySelector("#lblStudentName") ||
        document.querySelector(".user-name");
      return el ? el.innerText : "Sinh viên";
    });

    await page.close();
    return studentName;
  } catch (error) {
    await page.close();
    throw error;
  }
}

/**
 * Hàm chính: Lấy lịch học
 */
async function fetchSchedule(browser, username, password) {
  const page = await browser.newPage();

  // Tắt tải ảnh và font để chạy nhanh hơn
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (["image", "stylesheet", "font"].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });

  try {
    // 1. Đăng nhập
    await performLogin(page, username, password);

    console.log("[SCRAPER] Đang vào trang Lịch học...");

    // 2. Vào trang Lịch học
    await page.goto(
      "http://qldt.actvn.edu.vn/CMCSoft.IU.Web.info/Reports/Form/StudentTimeTable.aspx",
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );

    // 3. Chờ bảng hiện ra (ĐÂY LÀ CHỖ BỊ LỖI TRƯỚC ĐÓ)
    try {
      console.log("Đang chờ bảng lịch xuất hiện...");
      // Tăng timeout lên 60000 (60 giây)
      await page.waitForSelector("table", { timeout: 60000 });
    } catch (e) {
      throw new Error(
        "Quá thời gian chờ (60s) mà không thấy bảng lịch. Web trường quá chậm."
      );
    }

    // 4. Cào dữ liệu
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

    await page.close();
    return scheduleData;
  } catch (error) {
    await page.close();
    throw error;
  }
}

module.exports = { fetchSchedule, fetchStudentName };
