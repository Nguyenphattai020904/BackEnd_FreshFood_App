Từng bước chạy app:
- mở cmd gõ ipcofig check ipv4 192.168.....
- copy và sửa lại các file Retrofit, SercurityUtils, ChatbotFragment ở Front end và order.js BASE_URL ở Back end.
- mở cmd gõ ngrok http 3000 copy public url https:/... và dán vào các file zalopay/zalopay.js, Routes/order.js
- gõ lệnh pm2 stop để tắt server, sau đó delete cuối cùng là là start: pm2 start server.js --name "my-server"
  
