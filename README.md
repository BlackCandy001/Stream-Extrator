# Stream Downloader Companion

**Stream Downloader Companion** là một tiện ích mở rộng (extension) cho trình duyệt (Chrome, Edge, Firefox) giúp tự động phát hiện và thu thập các liên kết truyền tải video (HLS/m3u8, DASH/mpd) từ các trang web và gửi chúng trực tiếp đến ứng dụng desktop **Stream Downloader**.

## ✨ Tính năng chính

- 🔍 **Tự động phát hiện**: Tự động tìm kiếm các liên kết `.m3u8` và `.mpd` thông qua network requests, thẻ video, và nội dung script.
- 📱 **Sidebar tiện lợi**: Giao diện sidebar giúp quản lý danh sách các luồng đã phát hiện mà không làm gián đoạn trải nghiệm duyệt web.
- 🔔 **Thông báo thời gian thực**: Nhận thông báo ngay khi một luồng video mới được tìm thấy.
- 🚀 **Tự động gửi (Auto-send)**: Tùy chọn tự động gửi liên kết đến ứng dụng desktop ngay khi phát hiện.
- 📋 **Sao chép nhanh**: Dễ dàng sao chép URL hoặc gửi thủ công từng liên kết.
- 🛠️ **Tùy chỉnh máy chủ**: Linh hoạt thay đổi địa chỉ server của ứng dụng desktop.

## 🚀 Cài đặt

### Cho trình duyệt dựa trên Chromium (Chrome, Edge, Brave...)

1. Tải mã nguồn của extension về máy.
2. Truy cập `chrome://extensions/`.
3. Bật **Developer mode** (Chế độ nhà phát triển) ở góc trên bên phải.
4. Chọn **Load unpacked** (Tải tiện ích đã giải nén) và trỏ đến thư mục chứa dự án này.

### Cho Firefox

1. Truy cập `about:debugging#/runtime/this-firefox`.
2. Chọn **Load Temporary Add-on...** (Tải tiện ích tạm thời).
3. Chọn file `manifest.json` trong thư mục dự án.

## 📖 Hướng dẫn sử dụng

1. **Mở Sidebar**: Click vào biểu tượng extension hoặc mở sidebar từ menu trình duyệt (đối với Firefox).
2. **Duyệt Web**: Truy cập các trang web chứa video (như YouTube, phim, livestream...). Extension sẽ tự động đếm số lượng stream tìm thấy trên badge.
3. **Quản lý Stream**:
   - Sử dụng ô tìm kiếm để lọc stream theo tiêu đề hoặc URL.
   - Lọc theo loại định dạng (HLS, DASH).
   - Click **Send** để gửi đến app desktop hoặc **Copy** để lưu vào clipboard.
4. **Cấu hình**:
   - Nhập địa chỉ máy chủ (mặc định là `127.0.0.1:34567`).
   - Kiểm tra trạng thái kết nối thông qua chấm đèn tín hiệu (Xanh: Đã kết nối, Đỏ: Mất kết nối).

## 📂 Cấu trúc dự án

- `icons/`: Chứa các biểu tượng của extension.
- `src/background/`: Logic xử lý ngầm, quản lý lưu trữ và giao tiếp với desktop app.
- `src/content/`: Script được tiêm vào trang web để bắt các network requests và phân tích DOM.
- `src/sidebar/`: Giao diện người dùng và logic điều khiển sidebar.
- `manifest.json`: File cấu hình định nghĩa quyền hạn và các thành phần của extension.

---

Phát triển bởi **Stream Downloader Team**. Dự án này là một phần của hệ sinh thái hỗ trợ [N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE).
