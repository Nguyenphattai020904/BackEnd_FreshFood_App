const axios = require('axios');
const db = require('./db');

async function fetchProducts() {
    try {
        const translate = (await import('translate')).default;
        translate.engine = 'libre';
        translate.url = 'https://libretranslate.com/translate';

        const EXCHANGE_RATE = 23500; // 1 EUR ≈ 23500 VND
        const TOTAL_PRODUCTS = 1000;
        const PRODUCTS_PER_PAGE = 100;
        const TOTAL_PAGES = TOTAL_PRODUCTS / PRODUCTS_PER_PAGE;

        for (let page = 1; page <= TOTAL_PAGES; page++) {
            console.log(`🔄 Đang lấy dữ liệu từ trang ${page}...`);

            const response = await axios.get(
                `https://world.openfoodfacts.org/api/v2/search?fields=code,product_name,brands,categories,ingredients_text,nutriments,additives_tags,labels,image_url,quantity,origins,price&page_size=${PRODUCTS_PER_PAGE}&page=${page}`
            );

            const products = response.data.products;

            for (const product of products) {
                let { code, product_name, brands, categories, ingredients_text, nutriments, additives_tags, labels, image_url, quantity, origins } = product;

                if (!code || !product_name || !brands || !categories || !ingredients_text || !image_url) {
                    console.warn('⚠️ Bỏ qua sản phẩm do thiếu dữ liệu quan trọng');
                    continue;
                }

                // Dịch tất cả dữ liệu sang tiếng Việt, nếu lỗi giữ nguyên gốc
                const translateText = async (text) => {
                    if (!text) return '';
                    try {
                        return await translate(text, { from: 'auto', to: 'vi' });
                    } catch {
                        return text;
                    }
                };

                let translatedName = await translateText(product_name);
                let translatedCategory = await translateText(categories?.split(',')[0] || 'Chưa phân loại');
                let translatedOrigin = await translateText(origins);
                let translatedIngredients = await translateText(ingredients_text);

                // Xóa ký tự đặc biệt
                const cleanText = (text) => text.replace(/[^a-zA-Z0-9\sáàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđĐ]/g, '');

                translatedName = cleanText(translatedName);
                translatedCategory = cleanText(translatedCategory);
                translatedOrigin = cleanText(translatedOrigin);
                translatedIngredients = JSON.stringify(cleanText(translatedIngredients).split(','));

                const nutrients = JSON.stringify(nutriments || {});
                const additives = JSON.stringify(additives_tags || []);
                const ecoLabels = labels || '';
                const productImages = JSON.stringify([image_url]);
                const stockQuantity = quantity || 100;

                // Fake giá nếu không có, làm tròn giá tiền
                let priceEUR = (Math.random() * (3 - 0.5) + 0.5).toFixed(2); // Giá từ 0.5 đến 3 EUR
                let priceVND = Math.round(priceEUR * EXCHANGE_RATE); // Làm tròn VND

                const sql = `INSERT INTO products (barcode, name, brand, category, ingredients, nutrients, additives, eco_labels, weight_volume, origin, images, environment_data, price, quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                
                await db.query(sql, [code, translatedName, brands, translatedCategory, translatedIngredients, nutrients, additives, ecoLabels, quantity, translatedOrigin, productImages, '', priceVND, stockQuantity]);
            }
        }

        console.log('✅ Đã lấy đủ 1000 sản phẩm và lưu vào MySQL (tiếng Việt)!');
    } catch (err) {
        console.error('❌ Lỗi khi lấy dữ liệu:', err);
    }
}

fetchProducts();