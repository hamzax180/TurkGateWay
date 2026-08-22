'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, FileText, Mail, ChevronDown, LifeBuoy, Book, Users, GraduationCap, Scale, Headset, User, CreditCard, Search, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import MobileMenuButton from '../components/MobileMenuButton';
import BackButton from '../components/BackButton';
import Footer from '../components/Footer';
import CustomerServiceChat from '../components/CustomerServiceChat';
import MyTickets from '../components/MyTickets';

// ── Customer Service FAQ system ──────────────────────────────────────────────
// FAQ first, live chat second — the flow big Turkish e-commerce apps use
// (Yemeksepeti, Trendyol): search the knowledge list, and only escalate to a
// human-style agent when the answer isn't there.

type CsFaq = { id: string; cat: 'account' | 'payments' | 'credits' | 'services' | 'safety'; q: string; a: string };

const CS_FAQ: Record<string, CsFaq[]> = {
  en: [
    { id: 'account-create', cat: 'account', q: 'How do I create an account?', a: 'Tap Sign up, enter your email and a password of at least 8 characters, or continue with Google. It is free and takes under a minute.' },
    { id: 'password', cat: 'account', q: 'I forgot my password.', a: 'Self-service reset is on the way. For now, email support@turkgateway.ai from the address on your account and we will reset it for you.' },
    { id: '2fa', cat: 'account', q: 'How do I turn on two-factor authentication?', a: 'Settings → Security → Enable 2FA. Add the key to Google Authenticator or Authy, then confirm the 6-digit code. To turn it off you need a current code.' },
    { id: 'delete', cat: 'account', q: 'How do I delete my account?', a: 'Settings → Danger Zone → type DELETE. Your chats and personal data are erased; financial records are anonymized for legal audit.' },
    { id: 'methods', cat: 'payments', q: 'Which payment methods do you accept?', a: 'Cards via iyzico, Turkey\'s regulated payment provider, in Turkish Lira. We never see or store your card details.' },
    { id: 'paid-error', cat: 'payments', q: 'I paid but the page showed an error.', a: 'Wait a minute and refresh — checkout sometimes needs a moment to settle. If the credit still does not appear, email support with the date, amount and plan you bought.' },
    { id: 'credits-lost', cat: 'credits', q: 'I paid but my credits are missing.', a: 'No problem — this is usually a payment callback that failed to deliver. Press "No, I still need help" below and the agent will check your account and restore the credits right away.' },
    { id: 'refunds', cat: 'payments', q: 'How do refunds work?', a: 'Unused credits are refundable: email support@turkgateway.ai with your purchase date and amount. Used credits are not refundable.' },
    { id: 'credit-what', cat: 'credits', q: 'What is a service credit?', a: 'One credit books one full service — a complete roadmap for your business, or handing your visa or university application to our team.' },
    { id: 'credit-expiry', cat: 'credits', q: 'Do credits expire?', a: 'Yes — 12 months after purchase.' },
    { id: 'family', cat: 'payments', q: 'What is the family pack?', a: 'A pack of 5 credits you can share through invite links. Everyone you invite draws from the same pool.' },
    { id: 'invoice', cat: 'payments', q: 'Can I get an invoice or receipt?', a: 'iyzico emails you a payment receipt for every purchase. If you need a formal invoice for your company, email support@turkgateway.ai with the purchase date and amount.' },
    { id: 'autorenew', cat: 'payments', q: 'Do credits renew automatically?', a: 'No — nothing renews or charges automatically. You buy credits only when you need them, and each one lives 12 months.' },
    { id: 'services-list', cat: 'services', q: 'Which services can I book?', a: 'Visa appointment handling in Ashgabat and university placement. Roadmaps (permits, company setup, legal steps) are self-service in the chat.' },
    { id: 'languages', cat: 'services', q: 'Which languages do you support?', a: 'English, Turkish, Arabic and Turkmen — the site and the AI agents all speak them.' },
    { id: 'what-is', cat: 'services', q: 'What is TurkGateway?', a: 'TurkGateway is the AI agency for foreigners in Turkey: business agents that build step-by-step roadmaps for permits and licenses, a student agent for university and visa steps, a criminal defense lawyer, and a team that can take on visa appointments and university placements for you.' },
    { id: 'safety', cat: 'safety', q: 'Is my payment data safe?', a: 'Payments run on iyzico\'s PCI-DSS infrastructure. We do not store card numbers, and you can erase your account data anytime from Settings.' },
    { id: 'guest-usage', cat: 'account', q: 'Can I use the agency without an account?', a: 'Yes — you can browse and even chat as a guest. Creating an account (free) is needed to save conversations, book services and get your credits restored if a payment goes wrong.' },
  ],
  tr: [
    { id: 'account-create', cat: 'account', q: 'Nasıl hesap oluştururum?', a: 'Kayıt Ol\'a dokunun, e-posta ve en az 8 karakterli bir şifre girin veya Google ile devam edin. Ücretsizdir ve bir dakikadan kısa sürer.' },
    { id: 'password', cat: 'account', q: 'Şifremi unuttum.', a: 'Kendi kendine sıfırlama yakında geliyor. Şimdilik hesabınızdaki adresten support@turkgateway.ai adresine e-posta gönderin, sizin için sıfırlayalım.' },
    { id: '2fa', cat: 'account', q: 'İki adımlı doğrulamayı nasıl açarım?', a: 'Ayarlar → Güvenlik → 2FA\'yı etkinleştir. Anahtarı Google Authenticator veya Authy\'ye ekleyin, ardından 6 haneli kodu onaylayın. Kapatmak için güncel bir kod gerekir.' },
    { id: 'delete', cat: 'account', q: 'Hesabımı nasıl silerim?', a: 'Ayarlar → Tehlikeli Bölge → DELETE yazın. Sohbetleriniz ve kişisel verileriniz silinir; finansal kayıtlar yasal denetim için anonimleştirilir.' },
    { id: 'methods', cat: 'payments', q: 'Hangi ödeme yöntemlerini kabul ediyorsunuz?', a: 'Türkiye\'nin regüle ödeme kuruluşu iyzico üzerinden kart ile, Türk Lirası cinsinden. Kart bilgilerinizi asla görmeyiz veya saklamayız.' },
    { id: 'paid-error', cat: 'payments', q: 'Ödedim ama sayfada hata çıktı.', a: 'Bir dakika bekleyip yenileyin — ödeme bazen birkaç saniye içinde tamamlanır. Kredi yine görünmezse tarih, tutar ve satın aldığınız planla birlikte destek e-postası atın.' },
    { id: 'credits-lost', cat: 'credits', q: 'Ödedim ama kredilerim görünmüyor.', a: 'Sorun değil — bu genellikle tamamlanamayan bir ödeme bildirimidir. Aşağıdaki "Hayır, hâlâ yardım lazım" düğmesine basın; temsilcimiz hesabınızı kontrol edip kredilerinizi hemen geri yükler.' },
    { id: 'refunds', cat: 'payments', q: 'İadeler nasıl çalışır?', a: 'Kullanılmamış krediler iade edilebilir: satın alma tarihi ve tutarıyla support@turkgateway.ai adresine e-posta gönderin. Kullanılmış krediler iade edilmez.' },
    { id: 'credit-what', cat: 'credits', q: 'Hizmet kredisi nedir?', a: 'Bir kredi, tam bir hizmeti kapsar — işletmeniz için eksiksiz yol haritası, veya vize/üniversite başvurunuzun ekibimize teslim edilmesi.' },
    { id: 'credit-expiry', cat: 'credits', q: 'Kredilerin süresi dolar mı?', a: 'Evet — satın alma tarihinden itibaren 12 ay geçerlidir.' },
    { id: 'family', cat: 'payments', q: 'Aile paketi nedir?', a: 'Davet bağlantılarıyla paylaşabileceğiniz 5 kredilik bir paket. Davet ettiğiniz herkes aynı havuzdan kullanır.' },
    { id: 'invoice', cat: 'payments', q: 'Fatura veya makbuz alabilir miyim?', a: 'iyzico her satın alma için e-postanıza ödeme makbuzu gönderir. Şirketiniz için resmi fatura gerekiyorsa satın alma tarihi ve tutarıyla support@turkgateway.ai adresine yazın.' },
    { id: 'autorenew', cat: 'payments', q: 'Krediler otomatik yenilenir mi?', a: 'Hayır — hiçbir şey otomatik yenilenmez veya otomatik ücretlendirilmez. Kredileri yalnızca ihtiyacınız olduğunda alırsınız ve her biri 12 ay geçerlidir.' },
    { id: 'services-list', cat: 'services', q: 'Hangi hizmetleri rezerve edebilirim?', a: 'Aşkabat\'ta vize randevusu takibi ve üniversite yerleştirme. Yol haritaları (ruhsatlar, şirket kurulumu, hukuki adımlar) sohbette self-servistir.' },
    { id: 'languages', cat: 'services', q: 'Hangi dilleri destekliyorsunuz?', a: 'İngilizce, Türkçe, Arapça ve Türkmence — site ve yapay zekâ ajanlarının tümü bu dilleri konuşur.' },
    { id: 'what-is', cat: 'services', q: 'TurkGateway nedir?', a: 'TurkGateway, Türkiye\'deki yabancılar için yapay zekâ ajansıdır: ruhsat ve lisanslar için adım adım yol haritaları kuran iş ajanları, üniversite ve vize adımları için öğrenci ajanı, ceza savunma avukatı ve vize randevuları ile üniversite yerleştirmelerini sizin adınıza üstlenen bir ekip.' },
    { id: 'safety', cat: 'safety', q: 'Ödeme bilgilerim güvende mi?', a: 'Ödemeler iyzico\'nun PCI-DSS altyapısında çalışır. Kart numarası saklamayız ve hesap verilerinizi Ayarlar\'dan istediğiniz an silebilirsiniz.' },
    { id: 'guest-usage', cat: 'account', q: 'Hesap oluşturmadan ajansı kullanabilir miyim?', a: 'Evet — gezinebilir, hatta misafir olarak sohbet edebilirsiniz. Sohbetleri kaydetmek, hizmet rezerve etmek ve ödeme sorununda kredilerinizi geri almak için ücretsiz hesap gerekir.' },
  ],
  ar: [
    { id: 'account-create', cat: 'account', q: 'كيف أنشئ حساباً؟', a: 'اضغط على التسجيل، وأدخل بريدك وكلمة مرور من 8 أحرف على الأقل، أو تابع عبر Google. التسجيل مجاني ويستغرق أقل من دقيقة.' },
    { id: 'password', cat: 'account', q: 'نسيت كلمة المرور.', a: 'إعادة التعيين الذاتي قادمة قريباً. حالياً أرسل بريداً من عنوان حسابك إلى support@turkgateway.ai وسنعيد تعيينها لك.' },
    { id: '2fa', cat: 'account', q: 'كيف أفعل التحقق بخطوتين؟', a: 'الإعدادات ← الأمان ← تفعيل التحقق بخطوتين. أضف المفتاح إلى Google Authenticator أو Authy ثم أكد الرمز المكوّن من 6 أرقام. لإيقافه تحتاج رمزاً حالياً.' },
    { id: 'delete', cat: 'account', q: 'كيف أحذف حسابي؟', a: 'الإعدادات ← منطقة الخطر ← اكتب DELETE. تُحذف محادثاتك وبياناتك الشخصية، وتُخفى السجلات المالية للتدقيق القانوني.' },
    { id: 'methods', cat: 'payments', q: 'ما طرق الدفع المقبولة؟', a: 'البطاقات عبر iyzico، مزود الدفع المنظم في تركيا، بالليرة التركية. لا نرى بيانات بطاقتك ولا نخزنها أبداً.' },
    { id: 'paid-error', cat: 'payments', q: 'دفعت لكن الصفحة أظهرت خطأ.', a: 'انتظر دقيقة ثم حدّث الصفحة — قد تحتاج عملية الدفع لحظات لتكتمل. إذا لم يظهر الرصيد، راسل الدعم بالتاريخ والمبلغ والباقة المشتراة.' },
    { id: 'credits-lost', cat: 'credits', q: 'دفعت لكن رصيدي مفقود.', a: 'لا مشكلة — غالباً هذا إشعار دفع لم يكتمل. اضغط "لا، ما زلت بحاجة للمساعدة" بالأسفل وسيفحص الوكيل حسابك ويعيد الرصيد فوراً.' },
    { id: 'refunds', cat: 'payments', q: 'كيف تعمل عمليات الاسترداد؟', a: 'الأرصدة غير المستخدمة قابلة للاسترداد: أرسل بريداً إلى support@turkgateway.ai مع تاريخ الشراء والمبلغ. الأرصدة المستخدمة غير قابلة للاسترداد.' },
    { id: 'credit-what', cat: 'credits', q: 'ما هو رصيد الخدمة؟', a: 'رصيد واحد يحجز خدمة كاملة — خارطة طريق متكاملة لأعمالك، أو تسليم طلب التأشيرة أو الجامعة لفريقنا.' },
    { id: 'credit-expiry', cat: 'credits', q: 'هل تنتهي صلاحية الأرصدة؟', a: 'نعم — بعد 12 شهراً من الشراء.' },
    { id: 'family', cat: 'payments', q: 'ما هي الباقة العائلية؟', a: 'باقة من 5 أرصدة تشاركها عبر روابط الدعوة. كل من تدعوه يستخدم من نفس الرصيد.' },
    { id: 'invoice', cat: 'payments', q: 'هل يمكنني الحصول على فاتورة أو إيصال؟', a: 'ترسل iyzico إيصال دفع لكل عملية شراء إلى بريدك. إذا احتجت فاتورة رسمية لشركتك، راسل support@turkgateway.ai مع تاريخ الشراء والمبلغ.' },
    { id: 'autorenew', cat: 'payments', q: 'هل يتجدد الرصيد تلقائياً؟', a: 'لا — لا شيء يتجدد أو يُدفع تلقائياً. تشتري الأرصدة فقط عند الحاجة، وكل رصيد صالح 12 شهراً.' },
    { id: 'services-list', cat: 'services', q: 'ما الخدمات التي يمكنني حجزها؟', a: 'متابعة موعد التأشيرة في عشق آباد والتسجيل الجامعي. خرائط الطريق (التراخيص، تأسيس الشركات، الخطوات القانونية) متاحة ذاتياً في الدردشة.' },
    { id: 'languages', cat: 'services', q: 'ما اللغات المدعومة؟', a: 'الإنجليزية والتركية والعربية والتركمانية — الموقع ووكلاء الذكاء الاصطناعي يتحدثونها جميعاً.' },
    { id: 'what-is', cat: 'services', q: 'ما هو TurkGateway؟', a: 'TurkGateway هي وكالة الذكاء الاصطناعي للأجانب في تركيا: وكلاء أعمال يبنون خرائط طريق للتراخيص، ووكيل طلاب لخطوات الجامعة والتأشيرة، ومحامي دفاع جنائي، وفريق يتولى عنك مواعيد التأشيرة والتسجيل الجامعي.' },
    { id: 'safety', cat: 'safety', q: 'هل بيانات الدفع آمنة؟', a: 'تعمل المدفوعات على بنية iyzico المتوافقة مع PCI-DSS. لا نخزن أرقام البطاقات، ويمكنك مسح بيانات حسابك في أي وقت من الإعدادات.' },
    { id: 'guest-usage', cat: 'account', q: 'هل يمكنني استخدام الوكالة بدون حساب؟', a: 'نعم — يمكنك التصفح والدردشة كزائر. إنشاء حساب (مجاني) ضروري لحفظ المحادثات وحجز الخدمات واستعادة رصيدك عند مشاكل الدفع.' },
  ],
  tk: [
    { id: 'account-create', cat: 'account', q: 'Hasaby nädip döredýärin?', a: 'Agza bolmak düwmesine basyň, e-poçta we iň azy 8 belgili parol giriziň ýa-da Google bilen dowam ediň. Mugt we bir minutdan az wagt alýar.' },
    { id: 'password', cat: 'account', q: 'Parolymy ýatdan çykardym.', a: 'Özbaşdak täzeden dikeltmek ýakyn wagtda geler. Häzirlikçe hasabyňyzdaky salgydan support@turkgateway.ai salgysyna hat iberiň, biz täzeden dikeris.' },
    { id: '2fa', cat: 'account', q: 'Iki basgançakly tassyklamany nädip açýaryn?', a: 'Sazlamalar → Howpsuzlyk → 2FA-ny açyň. Açary Google Authenticator ýa-da Authy-a goşuň, soňra 6 sanly kody tassyklaň. Öçürmek üçin häzirki kod gerek.' },
    { id: 'delete', cat: 'account', q: 'Hasabymy nädip pozýaryn?', a: 'Sazlamalar → Howply Bölüm → DELETE ýazyň. Söhbetleriňiz we şahsy maglumatlaryňyz pozulýar; maliýe ýazgylary kanuny barlag üçin anonimleşdirilýär.' },
    { id: 'methods', cat: 'payments', q: 'Haýsy töleg usullaryny kabul edýärsiňiz?', a: 'Türkiýäniň düzgünleşdirilen töleg üpjün edijisi iyzico arkaly kart bilen, Türk lirasynda. Kart maglumatlaryňyzy hiç haçan göremzok we saklamaýarys.' },
    { id: 'paid-error', cat: 'payments', q: 'Töledim, ýöne sahypada ýalňyşlyk çykdy.', a: 'Bir minut garaşyp täzeläň — töleg käwagt birnäçe sekuntda tamamlanýar. Kredit ýene görünmese, senesi, möçberi we satyn alan planlyňyz bilen goldawa hat iberiň.' },
    { id: 'credits-lost', cat: 'credits', q: 'Töledim ýöne kreditlerim ýok.', a: 'Mesele däl — bu köplenç tamamlanmadyk töleg habarnamasydyr. Aşakdaky "Ýok, henizem kömek gerek" düwmesine basyň; agentimiz hasabyňyzy barlap kreditleriňizi derrew dikelder.' },
    { id: 'refunds', cat: 'payments', q: 'Yzyna gaýtarmalar nähili işleýär?', a: 'Ulanylmadyk kreditler yzyna gaýtarylýar: satyn alnan sene we möçber bilen support@turkgateway.ai salgysyna hat iberiň. Ulanylan kreditler gaýtarylmaýar.' },
    { id: 'credit-what', cat: 'credits', q: 'Hyzmat krediti näme?', a: 'Bir kredit bir doly hyzmaty ödeýär — işiňiz üçin doly ýol kartasy, ýa-da wiza/uniwersitet ýüz tutmasynyň toparymyza tabşyrylmagy.' },
    { id: 'credit-expiry', cat: 'credits', q: 'Kreditleriň möhleti gutarýarmy?', a: 'Hawa — satyn alnandan 12 aý soň.' },
    { id: 'family', cat: 'payments', q: 'Maşgala paketi näme?', a: 'Çakylyk baglanyşyklary arkaly paýlaşyp bolýan 5 kreditlik paket. Çagyrýanlaryň hemmesi şol bir howuzdan ulanýar.' },
    { id: 'invoice', cat: 'payments', q: 'Hasap-faktura ýa-da kwitansiýa alyp bilerinmi?', a: 'iyzico her satyn alma üçin e-poçtaňyza töleg kwitansiýasyny iberýär. Kompaniýaňyz üçin resmi faktura gerek bolsa, satyn alnan sene we möçber bilen support@turkgateway.ai salgysyna ýazyň.' },
    { id: 'autorenew', cat: 'payments', q: 'Kreditler awtomatik täzelenýärmi?', a: 'Ýok — hiç zat awtomatik täzelenmeýär ýa-da awtomatik töleg alynmaýar. Kreditleri diňe gerek bolanda satyn alýarsyňyz we hersiniň möhleti 12 aý.' },
    { id: 'services-list', cat: 'services', q: 'Haýsy hyzmatlary sargyt edip bilerin?', a: 'Aşgabatda wiza duşuşygyny alyp barmak we uniwersitet ýerleşdirmek. Ýol kartalary (rugsatnamalar, kompaniýa gurmak, hukuk ädimleri) söhbetde özbaşdak elýeterli.' },
    { id: 'languages', cat: 'services', q: 'Haýsy dilleri goldaýarsyňyz?', a: 'Iňlis, Türk, Arap we Türkmen — sahypa we AI agentleriň hemmesi bu dillerde gepleşýär.' },
    { id: 'what-is', cat: 'services', q: 'TurkGateway näme?', a: 'TurkGateway Türkiýedäki daşary ýurtlular üçin AI agentligidir: rugsatnamalar üçin ädimme-ädim ýol kartalaryny düzýän iş agentleri, uniwersitet we wiza üçin talyp agenti, jenaýat goragy aklawçysy we wiza duşuşyklary bilen uniwersitet ýerleşdirmelerini siziň adyňyzdan alyp barýan topar.' },
    { id: 'safety', cat: 'safety', q: 'Töleg maglumatlarym howpsuzmy?', a: 'Tölegler iyzico-nyň PCI-DSS infrastrukturasynda işleýär. Kart belgilerini saklamaýarys we hasap maglumatlaryňyzy islän wagtyňyz Sazlamalar-dan pozup bilersiňiz.' },
    { id: 'guest-usage', cat: 'account', q: 'Hasap döretmän agentligi ulanyp bilerinmi?', a: 'Hawa — aýlanyp, hatda myhman hökmünde söhbet edip bilersiňiz. Söhbetleri saklamak, hyzmat sargyt etmek we töleg meselesinde kreditleriňizi dikeltmek üçin mugt hasap gerek.' },
  ],
  ru: [
    { id: 'account-create', cat: 'account', q: 'Как создать аккаунт?', a: 'Нажмите «Регистрация», введите email и пароль не короче 8 символов, либо продолжите через Google. Это бесплатно и занимает меньше минуты.' },
    { id: 'password', cat: 'account', q: 'Я забыл пароль.', a: 'Самостоятельный сброс скоро появится. Пока напишите на support@turkgateway.ai с адреса, указанного в аккаунте, и мы сбросим пароль за вас.' },
    { id: '2fa', cat: 'account', q: 'Как включить двухфакторную аутентификацию?', a: 'Настройки → Безопасность → Включить 2FA. Добавьте ключ в Google Authenticator или Authy, затем подтвердите 6-значный код. Для отключения потребуется действующий код.' },
    { id: 'delete', cat: 'account', q: 'Как удалить аккаунт?', a: 'Настройки → Опасная зона → введите DELETE. Ваши переписки и личные данные удаляются; финансовые записи обезличиваются для юридического аудита.' },
    { id: 'methods', cat: 'payments', q: 'Какие способы оплаты вы принимаете?', a: 'Карты через iyzico — регулируемого платёжного провайдера Турции, в турецких лирах. Мы никогда не видим и не храним данные вашей карты.' },
    { id: 'paid-error', cat: 'payments', q: 'Я оплатил, но страница показала ошибку.', a: 'Подождите минуту и обновите страницу — оплате иногда нужно время, чтобы пройти. Если кредит так и не появился, напишите в поддержку, указав дату, сумму и купленный тариф.' },
    { id: 'credits-lost', cat: 'credits', q: 'Я оплатил, но кредиты не появились.', a: 'Не переживайте — обычно это несработавшее уведомление об оплате. Нажмите «Нет, мне всё ещё нужна помощь» ниже, и оператор проверит ваш аккаунт и сразу восстановит кредиты.' },
    { id: 'refunds', cat: 'payments', q: 'Как работает возврат средств?', a: 'Неиспользованные кредиты подлежат возврату: напишите на support@turkgateway.ai, указав дату покупки и сумму. Использованные кредиты возврату не подлежат.' },
    { id: 'credit-what', cat: 'credits', q: 'Что такое сервисный кредит?', a: 'Один кредит оплачивает одну полную услугу — готовый план для вашего бизнеса либо передачу визовой или университетской заявки нашей команде.' },
    { id: 'credit-expiry', cat: 'credits', q: 'Истекает ли срок действия кредитов?', a: 'Да — через 12 месяцев после покупки.' },
    { id: 'family', cat: 'payments', q: 'Что такое семейный пакет?', a: 'Пакет из 5 кредитов, которыми можно делиться по пригласительным ссылкам. Все приглашённые расходуют кредиты из общего запаса.' },
    { id: 'invoice', cat: 'payments', q: 'Могу ли я получить счёт или квитанцию?', a: 'iyzico отправляет квитанцию об оплате на email при каждой покупке. Если для компании нужен официальный счёт, напишите на support@turkgateway.ai с датой и суммой покупки.' },
    { id: 'autorenew', cat: 'payments', q: 'Кредиты продлеваются автоматически?', a: 'Нет — ничего не продлевается и не списывается автоматически. Вы покупаете кредиты только когда они нужны, и каждый действует 12 месяцев.' },
    { id: 'services-list', cat: 'services', q: 'Какие услуги я могу заказать?', a: 'Сопровождение визовой записи в Ашхабаде и поступление в университет. Дорожные карты (разрешения, регистрация компании, юридические шаги) доступны самостоятельно в чате.' },
    { id: 'languages', cat: 'services', q: 'Какие языки вы поддерживаете?', a: 'Английский, турецкий, арабский и туркменский — на них говорят и сайт, и ИИ-агенты.' },
    { id: 'what-is', cat: 'services', q: 'Что такое TurkGateway?', a: 'TurkGateway — это ИИ-платформа для иностранцев в Турции: бизнес-агенты, которые строят пошаговые планы получения разрешений и лицензий, студенческий агент для университета и визы, адвокат по уголовным делам и команда, которая может взять на себя визовую запись и поступление в университет.' },
    { id: 'safety', cat: 'safety', q: 'Безопасны ли мои платёжные данные?', a: 'Платежи проходят на инфраструктуре iyzico с сертификацией PCI-DSS. Мы не храним номера карт, а данные аккаунта вы можете удалить в любой момент в Настройках.' },
    { id: 'guest-usage', cat: 'account', q: 'Можно ли пользоваться платформой без аккаунта?', a: 'Да — вы можете просматривать сайт и даже общаться в чате как гость. Бесплатный аккаунт нужен, чтобы сохранять переписки, заказывать услуги и восстановить кредиты, если с оплатой что-то пойдёт не так.' },
  ],
};

const CS_FAQ_TEXT: Record<string, Record<string, string>> = {
  en: {
    title: 'Customer Service',
    subtitle: 'Find your answer below — if it is not there, a live chat agent takes over.',
    account: 'Account & Security', payments: 'Payments & Refunds', credits: 'Credits & Services',
    helped: 'Did this help?', yes: 'Yes, thanks', thanks: 'Glad it helped!',
    stillNeedHelp: 'No, I still need help',
    online: 'Agents online', hours: '7/24',
    searchPlaceholder: 'Search help…',
    noResults: 'No answer matches that.',
    askAgent: 'Ask a live agent',
    liveChat: 'Live Chat',
  },
  tr: {
    title: 'Müşteri Hizmetleri',
    subtitle: 'Cevabınızı aşağıda bulun — burada yoksa canlı sohbet temsilcisi devralır.',
    account: 'Hesap & Güvenlik', payments: 'Ödemeler & İadeler', credits: 'Krediler & Hizmetler',
    helped: 'Bu yardımcı oldu mu?', yes: 'Evet, teşekkürler', thanks: 'Yardımcı olduuna sevindik!',
    stillNeedHelp: 'Hayır, hâlâ yardım lazım',
    online: 'Temsilciler çevrimiçi', hours: '7/24',
    searchPlaceholder: 'Yardım ara…',
    noResults: 'Buna uyan bir cevap yok.',
    askAgent: 'Canlı temsilciye sor',
    liveChat: 'Canlı Destek',
  },
  ar: {
    title: 'خدمة العملاء',
    subtitle: 'جد إجابتك بالأسفل — إن لم تكن هنا، يتولى وكيل الدردشة المباشرة الأمر.',
    account: 'الحساب والأمان', payments: 'الدفع والاسترداد', credits: 'الأرصدة والخدمات',
    helped: 'هل ساعدك هذا؟', yes: 'نعم، شكراً', thanks: 'سعدنا بمساعدتك!',
    stillNeedHelp: 'لا، ما زلت بحاجة للمساعدة',
    online: 'الوكلاء متصلون', hours: '7/24',
    searchPlaceholder: 'ابحث في المساعدة…',
    noResults: 'لا توجد إجابة مطابقة.',
    askAgent: 'اسأل وكيلاً مباشراً',
    liveChat: 'دردشة مباشرة',
  },
  tk: {
    title: 'Müşderi Hyzmaty',
    subtitle: 'Jogabyňyzy aşakdan tapyň — bu ýerde ýok bolsa, janly söhbet agenti öz üstüne alýar.',
    account: 'Hasap & Howpsuzlyk', payments: 'Tölegler & Yzyna gaýtarmalar', credits: 'Kreditler & Hyzmatlar',
    helped: 'Bu kömek etdimi?', yes: 'Hawa, sag boluň', thanks: 'Kömek edenimize begendik!',
    stillNeedHelp: 'Ýok, henizem kömek gerek',
    online: 'Agentler onlaýn', hours: '7/24',
    searchPlaceholder: 'Kömek gözleň…',
    noResults: 'Muna gabat gelýen jogap ýok.',
    askAgent: 'Janly agentden soraň',
    liveChat: 'Janly Söhbet',
  },
  az: {
    title: 'Müştəri Xidməti',
    subtitle: 'Cavabınızı aşağıda tapın — burada yoxdursa, canlı çat agenti dəvam edəcək.',
    account: 'Hesab və Təhlükəsizlik', payments: 'Ödənişlər və Geri qaytarma', credits: 'Kreditlər və Xidmətlər',
    helped: 'Bu kömək etdi?', yes: 'Bəli, sağ olun', thanks: 'Kömək etdiyimizə sevindik!',
    stillNeedHelp: 'Xeyr, hələ də kömək lazımdır',
    online: 'Agentlər onlayn', hours: '7/24',
    searchPlaceholder: 'Kömək axtar…',
    noResults: 'Buna uyğun cavab yoxdur.',
    askAgent: 'Canlı agentə sual verin',
    liveChat: 'Canlı Söhbət',
  },
  uz: {
    title: 'Mijozlarga xizmat',
    subtitle: 'Javobingizni quyidan toping — agar u yerda bo‘lmasa, jonli chat agenti yordam beradi.',
    account: 'Hisob va Xavfsizlik', payments: 'To‘lovlar va Qaytarishlar', credits: 'Kreditlar va Xizmatlar',
    helped: 'Bu yordam berdimi?', yes: 'Ha, rahmat', thanks: 'Yordam berganimizdan xursandmiz!',
    stillNeedHelp: 'Yo‘q, menga hali ham yordam kerak',
    online: 'Agentlar onlayn', hours: '7/24',
    searchPlaceholder: 'Yordam qidirish…',
    noResults: 'Bunga mos javob topilmadi.',
    askAgent: 'Jonli agentdan so‘rang',
    liveChat: 'Jonli chat',
  },
  kk: {
    title: 'Клиенттерге қызмет көрсету',
    subtitle: 'Жауабыңызды төменден табыңыз — онда болмаса, тікелей чат агенті көмектеседі.',
    account: 'Аккаунт және Қауіпсіздік', payments: 'Төлемдер мен қайтару', credits: 'Кредиттер мен қызметтер',
    helped: 'Бұл көмектесті ме?', yes: 'Иә, рахмет', thanks: 'Көмектескенімізге қуаныштымыз!',
    stillNeedHelp: 'Жоқ, маған әлі көмек керек',
    online: 'Агенттер желіде', hours: '7/24',
    searchPlaceholder: 'Көмектен іздеу…',
    noResults: 'Сәйкес жауап табылмады.',
    askAgent: 'Тікелей агенттен сұраңыз',
    liveChat: 'Тікелей чат',
  },
  fa: {
    title: 'خدمات مشتری',
    subtitle: 'پاسخ خود را در زیر بیابید — اگر نبود، کارشناس گفتگوی زنده پاسخگو است.',
    account: 'حساب و امنیت', payments: 'پرداخت و استرداد', credits: 'اعتبارها و خدمات',
    helped: 'آیا این کمک کرد؟', yes: 'بله، ممنون', thanks: 'خوشحالیم که کمک کرد!',
    stillNeedHelp: 'خیر، هنوز کمک می‌خواهم',
    online: 'کارشناسان آنلاین', hours: '7/24',
    searchPlaceholder: 'جستجو در راهنما…',
    noResults: 'پاسخ مطابقی یافت نشد.',
    askAgent: 'از کارشناس زنده بپرسید',
    liveChat: 'گفتگوی زنده',
  },
  ru: {
    title: 'Клиентская служба',
    subtitle: 'Найдите ответ ниже — если его там нет, подключится живой агент.',
    account: 'Аккаунт и безопасность', payments: 'Платежи и возвраты', credits: 'Кредиты и услуги',
    helped: 'Это помогло?', yes: 'Да, спасибо', thanks: 'Рады были помочь!',
    stillNeedHelp: 'Нет, мне всё ещё нужна помощь',
    online: 'Агенты онлайн', hours: '7/24',
    searchPlaceholder: 'Поиск по справке…',
    noResults: 'Нет подходящего ответа.',
    askAgent: 'Спросить живого агента',
    liveChat: 'Живой чат',
  },
};

export default function HelpPage() {
  const { t, isRTL, language } = useLanguage();
  const { token } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Customer Service FAQ state
  const [csOpen, setCsOpen] = useState<string | null>(null);
  const [csQuery, setCsQuery] = useState('');
  const [csFeedback, setCsFeedback] = useState<Record<string, 'yes'>>({});
  const [escalateTo, setEscalateTo] = useState<string | null>(null);
  const [chatVisible, setChatVisible] = useState(false);

  // The page chrome is translated into all nine languages, but the 18 Q&As are
  // not — so the two resolve separately. Chrome uses the real language; the
  // answers fold onto the nearest neighbour that exists (Azeri reads Turkish,
  // Uzbek reads Turkmen, Kazakh reads Russian, Persian shares Arabic script)
  // instead of dumping five languages onto English.
  const csText = CS_FAQ_TEXT[language] ?? CS_FAQ_TEXT.en;
  const CS_FAQ_FALLBACK: Record<string, string> = { az: 'tr', uz: 'tk', kk: 'ru', fa: 'ar' };
  const csFaqs = CS_FAQ[language] ?? CS_FAQ[CS_FAQ_FALLBACK[language]] ?? CS_FAQ.en;

  // Search filters the question and the answer, so someone who types a word
  // from the middle of an answer ("iyzico", "12 months") still lands on it.
  const csNeedle = csQuery.trim().toLowerCase();
  const csMatches = csNeedle
    ? csFaqs.filter((f) => `${f.q} ${f.a}`.toLowerCase().includes(csNeedle))
    : csFaqs;

  // Stacked sections; each FAQ item lives inside its section. Sections with no
  // match drop out entirely rather than showing an empty card.
  const csSections = [
    { id: 'account', icon: User, label: csText.account, cats: ['account', 'safety'] },
    { id: 'payments', icon: CreditCard, label: csText.payments, cats: ['payments'] },
    { id: 'credits', icon: Headset, label: csText.credits, cats: ['credits', 'services'] },
  ]
    .map((s) => ({ ...s, items: csMatches.filter((f) => s.cats.includes(f.cat)) }))
    .filter((s) => s.items.length > 0);

  const startLiveChat = (question: string) => {
    setEscalateTo(question);
    setChatVisible(true);
    // After the FAQ face flips away, bring the chat face into view.
    setTimeout(() => {
      document.getElementById('support-chat')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 700);
  };

  const categories = [
    { icons: [Book, GraduationCap, Scale], title: t('help_cat_docs_title'), desc: t('help_cat_docs_desc'), href: '/docs' },
    { icons: [Users], title: t('help_cat_community_title'), desc: t('help_cat_community_desc'), href: '/docs#community' },
    { icons: [FileText], title: t('help_cat_resources_title'), desc: t('help_cat_resources_desc'), href: '/docs#resources' },
  ];

  return (
    <div className="flex h-screen bg-[var(--bg)] text-[var(--text)] transition-colors duration-500 overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
      <Sidebar
        currentSessionId={null}
        assistantType="permit"
        onSessionSelect={(id) => {
          localStorage.setItem('TurkGateway_active_session_id', id);
          window.location.href = '/chat';
        }}
        onNewChat={() => {
          window.location.href = '/chat?new=true';
        }}
        onDeleteSession={() => {}}
        token={token}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      <main className="flex-1 flex flex-col min-w-0 transition-colors duration-300 relative overflow-y-auto slim-scroll">
        <Navbar isAppPage onMobileMenuClick={() => setMobileMenuOpen(true)} />
        <MobileMenuButton onClick={() => setMobileMenuOpen(true)} />

        <div className="w-full px-6 md:px-12 py-8 md:py-16">
          {/* ── Page header ──────────────────────────────────────────────────
              Was a full-width all-caps wordmark in `text-white` with a dark
              text-shadow — invisible against the warm paper background. A page
              this deep in the app wants a page title, not a logo. */}
          <div className="max-w-3xl mx-auto">
            <BackButton className="mb-5" />
            <h1 className="text-3xl md:text-5xl font-semibold tracking-tight text-[var(--text)]">
              {csText.title}
            </h1>

            <p className="mt-3 text-[15px] md:text-base leading-relaxed text-[var(--muted)] max-w-2xl">
              {csText.subtitle}
            </p>
          </div>

          {/* ── Customer Service FAQ ⇄ live chat ── */}
          <div className="max-w-3xl mx-auto mt-8 md:mt-10">
            <AnimatePresence mode="wait">
              {!chatVisible ? (
                <motion.div
                  key="faq-face"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                >
                  {/* Search */}
                  <div className="relative">
                    <Search
                      size={17}
                      className="absolute top-1/2 -translate-y-1/2 start-4 text-[var(--muted)] pointer-events-none"
                    />
                    <input
                      value={csQuery}
                      onChange={(e) => setCsQuery(e.target.value)}
                      placeholder={csText.searchPlaceholder}
                      className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] ps-11 pe-4 py-3.5 text-[15px] text-[var(--text)] placeholder:text-[var(--muted)] shadow-sm focus:outline-none focus:border-[var(--border-2)] transition-colors"
                    />
                  </div>

                  {/* Sections */}
                  <div className="mt-8 space-y-8">
                    {csSections.map((section) => {
                      const SectionIcon = section.icon;
                      return (
                        <section key={section.id}>
                          <div className="flex items-center gap-2 mb-3 px-1">
                            <SectionIcon size={14} className="text-[var(--muted)]" />
                            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                              {section.label}
                            </h2>
                          </div>

                          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                            <div className="divide-y divide-[var(--border)]">
                              {section.items.map((item) => (
                                <div key={item.id}>
                                  <button
                                    onClick={() => setCsOpen(csOpen === item.id ? null : item.id)}
                                    className="w-full text-start px-5 py-4 flex items-center justify-between gap-4 hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                                  >
                                    <span className="text-[15px] font-medium leading-snug text-[var(--text)]">{item.q}</span>
                                    <ChevronDown
                                      className={`shrink-0 w-4 h-4 text-[var(--muted)] transition-transform duration-300 ${csOpen === item.id ? 'rotate-180' : ''}`}
                                    />
                                  </button>

                                  <AnimatePresence initial={false}>
                                    {csOpen === item.id && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.25, ease: 'easeOut' }}
                                        className="overflow-hidden"
                                      >
                                        <div className="px-5 pb-5 text-[14px] leading-relaxed text-[var(--muted)]">
                                          {item.a}

                                          <div className="mt-4 flex flex-wrap items-center gap-2">
                                            <span className="text-[12px] text-[var(--muted)] me-1">{csText.helped}</span>
                                            {csFeedback[item.id] === 'yes' ? (
                                              <span className="px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-[12px] font-medium">
                                                {csText.thanks}
                                              </span>
                                            ) : (
                                              <button
                                                onClick={() => setCsFeedback((f) => ({ ...f, [item.id]: 'yes' }))}
                                                className="px-3 py-1.5 rounded-full border border-[var(--border-2)] bg-[var(--surface)] text-[12px] font-medium text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                                              >
                                                {csText.yes}
                                              </button>
                                            )}
                                            <button
                                              onClick={() => startLiveChat(item.q)}
                                              className="px-3 py-1.5 rounded-full border border-red-500/30 text-[12px] font-medium text-red-600 dark:text-red-400 hover:bg-red-500/5 transition-colors flex items-center gap-1.5 cursor-pointer"
                                            >
                                              <MessageCircle size={12} />
                                              {csText.stillNeedHelp}
                                            </button>
                                          </div>
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              ))}
                            </div>
                          </div>
                        </section>
                      );
                    })}

                    {/* Nothing matched — hand the query straight to an agent */}
                    {csSections.length === 0 && (
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center">
                        <p className="text-[15px] text-[var(--text)]">{csText.noResults}</p>
                        <button
                          onClick={() => startLiveChat(csQuery)}
                          className="mt-4 inline-flex items-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-[13px] font-medium text-white hover:bg-red-700 transition-colors cursor-pointer"
                        >
                          <MessageCircle size={14} />
                          {csText.askAgent}
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="chat-face"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                >
                  <CustomerServiceChat
                    initialQuestion={escalateTo}
                    onBack={() => {
                      setChatVisible(false);
                      setEscalateTo(null);
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Signed-in customers see their own support history here */}
          <MyTickets />

          {/* Quick Links Category Cards — Documentation, Community, Resources */}
          <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mt-14 md:mt-20">
            {categories.map((cat, i) => (
              <Link href={cat.href} key={i} className="no-underline">
                <motion.div
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.99 }}
                  className="group h-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 flex flex-row md:flex-col items-center md:items-start gap-4 md:gap-0 transition-colors hover:border-[var(--border-2)] cursor-pointer"
                >
                  <div className="mb-0 md:mb-5 flex gap-1.5 shrink-0">
                    {cat.icons.map((Icon, idx) => (
                      <div key={idx} className="p-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
                        <Icon className="w-4 h-4 text-[var(--muted)]" />
                      </div>
                    ))}
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] md:text-base font-semibold tracking-tight text-[var(--text)]">{cat.title}</h3>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted)] line-clamp-2 md:line-clamp-none">{cat.desc}</p>
                    <span className="mt-3 hidden md:flex items-center gap-1.5 text-[12px] font-medium text-[var(--text)]">
                      {t('help_explore')}
                      <ArrowRight size={13} className="text-red-500 transition-transform group-hover:translate-x-1" />
                    </span>
                  </div>
                </motion.div>
              </Link>
            ))}
          </div>

          {/* Support CTA */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="mt-14 md:mt-20 mb-12 md:mb-20 max-w-3xl mx-auto rounded-3xl bg-[#1d1a15] text-[#faf8f4] text-center px-6 py-12 md:px-12 md:py-16"
          >
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white/10 border border-white/15 mb-5">
              <LifeBuoy className="w-6 h-6" />
            </div>

            <h3 className="text-2xl md:text-3xl font-semibold tracking-tight mb-3">{t('help_still_questions')}</h3>
            <p className="text-[#faf8f4]/70 mb-8 text-[15px] md:text-base max-w-xl mx-auto leading-relaxed">
              {t('help_support_desc')}
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center w-full sm:w-auto">
              <a
                href="mailto:support@turkgateway.ai"
                className="px-7 py-3.5 rounded-full bg-[#faf8f4] text-[#1d1a15] font-medium text-[14px] hover:bg-white transition-colors flex items-center justify-center gap-2 no-underline"
              >
                <Mail size={17} />
                {t('help_email_support')}
              </a>
              <button
                onClick={() => startLiveChat('')}
                className="px-7 py-3.5 rounded-full border border-white/20 text-[#faf8f4] font-medium text-[14px] hover:bg-white/10 transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <MessageCircle size={17} />
                {csText.liveChat}
              </button>
            </div>
          </motion.div>
        </div>

        <Footer />
      </main>
    </div>
  );
}
