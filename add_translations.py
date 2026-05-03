import json

# Load all current data
with open('backend/agents/student/responses.json', encoding='utf-8', errors='ignore') as f:
    en_data = json.load(f)

with open('backend/agents/student/responses_tr.json', encoding='utf-8', errors='ignore') as f:
    tr_data = json.load(f)

with open('backend/agents/student/responses_ar.json', encoding='utf-8', errors='ignore') as f:
    ar_data = json.load(f)

# Turkish translations for missing keys
turkish_translations = {
    "shelp": [
        "🎓 **Öğrenci Yardım Merkezi** 🆘\n\nBurslu öğrenci olarak Türkiye eğitim sistemi hakkında endişeleriniz var mı? Ben size yardımcı olabilirim!\n\n📄 **Uzmanlık Alanlarım:**\n• Üniversite kaydı ve öğrenci vizesi\n• Kimlik yenileme ve Ikamet prosedürleri\n• Yurt ve konut bulma\n• Diskont ulaşım kartı başvurusu\n• Burs ve finansal yardım\n\n💬 Bugün sana ne konuda yardımcı olabilirim?",
        "🎓 **Nasıl Yardımcı Olabilirim?** 🆘\n\nÖğrenci hayatınızı kolaylaştırmak için buradayım!\n\n🚀 **Hızlı Konular:**\n1. 'Üniversiteye nasıl kayıt olabilirim?'\n2. 'Öğrenci kimliğimi kaybettim.'\n3. 'Öğrenci ulaşım kartı nasıl alırım?'\n4. 'Türkiye'de çalışabilir miyim?'\n\n💬 Herhangi bir prosedür hakkında sorularınız mı var?",
        "🎓 **Öğrenci Destek Merkezi** 🆘\n\nTürkiye'deki üniversite sistemi karmaşık olabilir. Adım adım rehberlik sunmak için hazırım.\n\n📋 **Yardımcı Olabileceğim Konular:**\n• Üniversite seçimi ve kaydı\n• Vize işlemleri\n• Kimlik/Ikamet yenileme\n• Mali yardım\n• Konaklama bulma\n\n💬 Neye ihtiyacın var?"
    ],
    "visa_clarify": [
        "🎓 **Öğrenci Vizesi – Durumunu Öğrenelim!**\n\nHarika bir soru! Sana yardımcı olmadan önce:\n\n👉 **Zaten öğrenci vizesini aldın mı, yoksa başvuru sürecinde misin?**\n\nBu, sana doğru sonraki adımları vermeme yardımcı olacak! 😊",
        "🎓 **Türk Öğrenci Vizesi Bilgisi**\n\nAnlatmaya hazırım! Önce durumunu anlamam gerekiyor:\n\n❓ **Öğrenci vizesini zaten aldın mı?**\n\n- **EVET** → Sonraki adımlara (ikamet vb.) rehberlik edeceğim\n- **HAYIR** → Başvuru sürecinde yardımcı olacağım\n\nDurumun nedir? 👇",
        "🎓 **Vize Rehberliği**\n\nSana en iyi tavsiyeyi verebilmek için:\n\n✨ **Öğrenci vizesini almış mısın?**\n\nCevabın sonraki adımları belirleyecek! 😊"
    ],
    "visa_not_applied": [
        "🎓 **Öğrenci Vize Başvurusu – Başlayalım!**\n\nSorun değil! Sana vize alma sürecini göstereceğim:\n\n**İlk soru:** Nereden başvuru yapmak istiyorsun? Bu, hangi Türk konsolosu seni yönetecek belirler.\n\n📍 **Popüler konsolosluklar:**\n• Riyad, Suudi Arabistan 🇸🇦\n• Dubai/Abu Dabi, BAE 🇦🇪\n• Kahire, Mısır 🇪🇬\n• Londra, Birleşik Krallık 🇬🇧\n• Berlin, Almanya 🇩🇪\n• New York, ABD 🇺🇸\n\n**Sadece kentin adını yaz, ben detayları verim!** ✨",
        "🎓 **Öğrenci Vizesi Başvurusu – Başlayalım!**\n\nHarika! İşlem adım adım şöyle:\n\n**Birinci soru:** Nereden başvuru yapacaksın? \n\nŞehir/ülkeni söyle, ben şunları verim:\n✅ Konsolosluk adresi\n✅ Randevu linki\n✅ Gerekli belgeler\n✅ İşlem süresi\n✅ Ülke-spesifik tavsiyeler\n\nNereden başvuru yapacaksın? 🌍"
    ],
    "visa_already_have": [
        "🎓 **Tebrikler! Vizeni Almışsın! 🎉**\n\nBu harika bir milestone! İşte Türkiye'de yapman gerekenler:\n\n**Sonraki adımlar:**\n\n✅ **1. Türkiye'ye gel** (vize düzenlemesinden 6 ay içinde)\n✅ **2. Üniversiteye kayıt ol** (kampüste ilk hafta)\n✅ **3. Sağlık sigortası al** (ikamet için zorunlu)\n✅ **4. Öğrenci İkameti başvurusu** (gelişten 30 gün içinde!)\n\n💬 Hangisinde yardımcı olabilirim?\n\nÇoğu öğrenci sonra konaklama bulma ister – ipuçları ister misin? 🏠",
        "🎓 **Vize Onayın Var! 🎊**\n\nFantastik! Yolun açık.\n\n📋 **Yapman gerekenler:**\n\n1️⃣ **Uçak bileti al** ve Türkiye'ye gel\n2️⃣ **Üniversiteye kayıt ol** (ilk hafta)\n3️⃣ **Sağlık sigortası al** (~650 TL/yıl minimum)\n4️⃣ **İkamet izni başvusunda** (gelişten 30 gün içinde!)\n\n⏰ **ÖNEMLİ:** Vizeni aşmayacaksın! İkameti başvurunu üniversite kaydından hemen sonra yap.\n\n💬 Hangi adımda yardım istiyorsun?"
    ],
    "visa_consulate_riyadh": [
        "🎓 **Riyad Türk Büyükelçiliği 🇸🇦**\n\n📍 **Adres:** Riyad Diploma Merkezinde, Nasım Bölgesi\n\n🌐 **Randevu:** https://vize.mfa.gov.tr (çevrimiçi)\n\n📄 **Gerekli Belgeler:**\n• Geçerli pasaport (asgari 6 ay)\n• Üniversite kabul mektubu\n• Doldurulmuş vize formu (TCI)\n• Biyometrik fotoğraf (2 kopya, 4x5cm)\n• Banka ekstresı (para kanıtı)\n• Sağlık sigortası poliçesi\n• Konaklama kanıtı\n\n⏰ **İşlem Süresi:** 5-15 iş günü\n\n💡 **Riyad İpucu:** Randevular Mayıs-Eylül aylarında çok hızlı dolar. Erkenden randevu al!\n\n⚠️ **Hac döneminde:** 2-3 hafta daha ekle.\n\n💬 Randevu almaya mı hazırsın, yoksa belgelerle yardıma mı ihtiyacın var?"
    ],
    "visa_consulate_dubai": [
        "🎓 **Dubai Türk Konsolosluğu 🇦🇪**\n\n📍 **Adres:** Dubai Dünya Ticaret Merkezi, Şeyh Zeyid Caddesi\n\n🌐 **Randevu:** https://vize.mfa.gov.tr\n\n📄 **Gerekli Belgeler:**\n• Geçerli pasaport (6+ ay)\n• Üniversite kabul mektubu  \n• Vize başvuru formu\n• 2 biyometrik fotoğraf (4x5cm)\n• Banka ekstresı (minimum para)\n• Sağlık sigortası belgesi\n• Konaklama sözleşmesi/mektubu\n\n⏰ **İşlem Süresi:** 5-10 iş günü\n\n✨ **BAE Avantajı:** Bazı BAE vatandaşları/oturanları e-Vize online başvuru yapabilir – sana uygun mu kontrol et!\n\n💡 **Dubai İpucu:** Diğer Orta Doğu konsoloslukları kadar kalabalık değil, genelde daha hızlı işlem!\n\n💬 Başvuru formunu doldurmak mı istiyorsun?"
    ],
    "visa_consulate_cairo": [
        "🎓 **Kahire Türk Büyükelçiliği 🇪🇬**\n\n📍 **Adres:** Kahire Diplomat Bölgesinde, Giza\n\n🌐 **Randevu:** https://vize.mfa.gov.tr\n\n📄 **Gerekli Belgeler:**\n• Geçerli Mısır pasaportu (6+ ay)\n• Üniversite kabul mektubu\n• Doldurulmuş vize formu\n• Biyometrik fotoğraf (2 kopya, 4x5cm)\n• Banka ekstresı/mali kaynaklar kanıtı\n• Sağlık sigortası\n• Konaklama belgesi\n\n⏰ **İşlem Süresi:** 7-15 iş günü\n\n💡 **Kahire İpucu:** Başvuru sırasında Arapça konuşurlar ama Ingilizce belgeler kabul edilir.\n\n💬 Sonraki adım?"
    ],
    "visa_consulate_london": [
        "🎓 **Londra Türk Büyükelçiliği 🇬🇧**\n\n📍 **Adres:** Belgrave Square 43, Londra\n\n🌐 **Randevu:** https://vize.mfa.gov.tr (VFS aracılığı)\n\n📄 **Gerekli Belgeler:**\n• Geçerli İngiliz pasaportu (6+ ay)\n• Üniversite kabul mektubu\n• Vize başvuru formu\n• İki biyometrik fotoğraf (35x45mm)\n• Banka ekstresı/mali kaynaklar\n• Sağlık sigortası poliçesi\n• Konaklama kanıtı (yurt veya rental)\n\n⏰ **İşlem Süresi:** 5-10 iş günü\n\n💷 **Vize Ücreti:** Güncel fiyat için VFS Global kontrol et\n\n💡 **Londra İpucu:** VFS Global aracılığı ile yapılır – telefon randevusu Al)\n\n💬 Başvuru sayfasını mı ziyaret etmek istiyorsun?"
    ],
    "visa_consulate_berlin": [
        "🎓 **Berlin Türk Büyükelçiliği 🇩🇪**\n\n📍 **Adres:** Tiergartenstraße 19-21, Berlin\n\n🌐 **Randevu:** https://vize.mfa.gov.tr\n\n📄 **Gerekli Belgeler:**\n• Geçerli Alman pasaportu (6+ ay)\n• Üniversite kabul mektubu\n• Doldurulmuş vize formu\n• Biyometrik fotoğraf (2 kopya, 4x5cm)\n• Banka ekstresinde gösterilen mali kaynaklar\n• Sağlık sigortası belgesi\n• Konaklama sözleşmesi\n\n⏰ **İşlem Süresi:** 5-10 iş günü\n\n💡 **Berlin İpucu:** Almanya'dan başvuran öğrenciler için en popüler konsulosluk. Takvim çabuk dolar!\n\n📞 **Randevu:** Sadece çevrimiçi sistem aracılığı\n\n💬 İmzalamadan önce sorular mı var?"
    ]
}

# Arabic translations for missing keys
arabic_translations = {
    "visa_clarify": [
        "🎓 **تأشيرة الطالب - دعنا نرتب وضعك!**\n\nسؤال رائع! قبل أن أساعدك:\n\n👉 **هل حصلت بالفعل على تأشيرة الطالب، أم أنك لا تزال في عملية التقديم?**\n\nهذا سيساعدني على إعطاؤك الخطوات الصحيحة! 😊",
        "🎓 **معلومات التأشيرة التركية للطلاب**\n\nأنا مستعد للمساعدة! أولاً، دعني أفهم وضعك:\n\n❓ **هل حصلت على تأشيرة الطالب بالفعل?**\n\n- **نعم** → سأرشدك للخطوات التالية (الإقامة وغيرها)\n- **لا** → سأساعدك في عملية التقديم\n\nما وضعك؟ 👇"
    ],
    "visa_not_applied": [
        "🎓 **تطبيق تأشيرة الطالب - لنبدأ!**\n\nلا مشكلة! إليك كيفية الحصول على التأشيرة:\n\n**السؤال الأول:** من أين تريد التقديم؟ هذا يحدد القنصلية التركية المسؤولة.\n\n📍 **القنصليات الشهيرة:**\n• الرياض، المملكة العربية السعودية 🇸🇦\n• دبي/أبو ظبي، الإمارات 🇦🇪\n• القاهرة، مصر 🇪🇬\n• لندن، المملكة المتحدة 🇬🇧\n• برلين، ألمانيا 🇩🇪\n• نيويورك، الولايات المتحدة 🇺🇸\n\n**اكتب اسم مدينتك فقط، وسأعطيك التفاصيل!** ✨"
    ],
    "visa_already_have": [
        "🎓 **تهانينا! حصلت على التأشيرة! 🎉**\n\nهذا إنجاز رائع! إليك ما يجب فعله بعد ذلك:\n\n**الخطوات التالية:**\n\n✅ **1. انتقل إلى تركيا** (خلال 6 أشهر من إصدار التأشيرة)\n✅ **2. سجل نفسك بالجامعة** (الأسبوع الأول في الحرم الجامعي)\n✅ **3. احصل على تأمين صحي** (مطلوب للإقامة)\n✅ **4. تقدم بطلب الإقامة (İkamet)** (خلال 30 يومًا من الوصول!)\n\n💬 في أي مرحلة أستطيع مساعدتك?\n\nمعظم الطلاب يريدون إيجاد سكن بعد ذلك - هل تريد نصائح؟ 🏠"
    ],
    "visa_consulate_riyadh": [
        "🎓 **السفارة التركية برياض Riyadh 🇸🇦**\n\n📍 **العنوان:** في حي الناصم، أول الدبلوماسي بالرياض\n\n🌐 **الحجز:** https://vize.mfa.gov.tr (عبر الإنترنت)\n\n📄 **المستندات المطلوبة:**\n• جواز سفر ساري (6 أشهر على الأقل)\n• خطاب قبول جامعي رسمي\n• نموذج طلب التأشيرة\n• صورتان بيومترية (4x5سم)\n• كشف حساب بنكي (إثبات أموال)\n• وثيقة تأمين صحي\n• إثبات سكن\n\n⏰ **وقت المعالجة:** 5-15 يوم عمل\n\n💡 **نصيحة الرياض:** المواعيد تمتلئ بسرعة من مايو إلى سبتمبر. احجز مبكراً!\n\n⚠️ **خلال موسم الحج:** أضف 2-3 أسابيع إضافية."
    ],
    "visa_consulate_dubai": [
        "🎓 **القنصلية التركية العامة في دبي 🇦🇪**\n\n📍 **العنوان:** مركز دبي التجاري العالمي، شارع الشيخ زايد\n\n🌐 **الحجز:** https://vize.mfa.gov.tr\n\n📄 **المستندات المطلوبة:**\n• جواز سفر ساري (6+ أشهر)\n• خطاب قبول جامعي\n• نموذج تطبيق التأشيرة\n• صورتان بيومتريتان (4x5سم)\n• كشف حساب بنكي\n• وثيقة التأمين الصحي\n• عقد أو خطاب إيجار\n\n⏰ **وقت المعالجة:** 5-10 أيام عمل\n\n✨ **ميزة الإمارات:** بعض مواطني/سكان الإمارات يمكنهم التقدم بطلب e-Visa عبر الإنترنت - تحقق إذا كان ينطبق عليك!\n\n💡 **نصيحة دبي:** أقل ازدحاماً من القنصليات الأخرى في الشرق الأوسط، عادةً معالجة أسرع!"
    ],
    "visa_consulate_cairo": [
        "🎓 **السفارة التركية بالقاهرة 🇪🇬**\n\n📍 **العنوان:** في حي الجيزة الدبلوماسي بالقاهرة\n\n🌐 **الحجز:** https://vize.mfa.gov.tr\n\n📄 **المستندات المطلوبة:**\n• جواز سفر مصري ساري (6+ أشهر)\n• خطاب قبول جامعي\n• نموذج التأشيرة المملوء\n• صورتان بيومتريتان (4x5سم)\n• إثبات المصادر المالية\n• وثيقة التأمين الصحي\n• إثبات السكن\n\n⏰ **وقت المعالجة:** 7-15 يوم عمل\n\n💡 **نصيحة القاهرة:** الموظفون قد يتحدثون العربية لكن يقبلون المستندات بالإنجليزية."
    ],
    "visa_consulate_london": [
        "🎓 **السفارة التركية بلندن 🇬🇧**\n\n📍 **العنوان:** Belgrave Square 43, لندن\n\n🌐 **الحجز:** https://vize.mfa.gov.tr (عبر VFS)\n\n📄 **المستندات المطلوبة:**\n• جواز سفر بريطاني ساري (6+ أشهر)\n• خطاب قبول جامعي\n• نموذج طلب التأشيرة\n• صورتان بيومتريتان (35x45م)\n• كشف حساب/مصادر مالية\n• وثيقة التأمين الصحي\n• إثبات السكن (سكن الطلاب أو إيجار)\n\n⏰ **وقت المعالجة:** 5-10 أيام عمل\n\n💷 **رسم التأشيرة:** تحقق من VFS Global للسعر الحالي\n\n💡 **نصيحة لندن:** تتم المعالجة عبر VFS Global - احجز موعداً!"
    ],
    "visa_consulate_berlin": [
        "🎓 **السفارة التركية ببرلين 🇩🇪**\n\n📍 **العنوان:** Tiergartenstraße 19-21, برلين\n\n🌐 **الحجز:** https://vize.mfa.gov.tr\n\n📄 **المستندات المطلوبة:**\n• جواز سفر ألماني ساري (6+ أشهر)\n• خطاب قبول جامعي\n• نموذج التأشيرة المملوء\n• صورتان بيومتريتان (4x5سم)\n• إثبات المصادر المالية برسالة بنكية\n• وثيقة التأمين الصحي\n• عقد السكن\n\n⏰ **وقت المعالجة:** 5-10 أيام عمل\n\n💡 **نصيحة برلين:** هذه القنصلية الأكثر شعبية بين الطلاب من ألمانيا. التقويم يمتلئ بسرعة!\n\n📞 **الحجز:** عبر الإنترنت فقط من خلال النظام"
    ]
}

# Add Turkish translations
for key, values in turkish_translations.items():
    if key not in tr_data:
        tr_data[key] = values
        print(f"Added Turkish: {key}")

# Add Arabic translations
for key, values in arabic_translations.items():
    if key not in ar_data:
        ar_data[key] = values
        print(f"Added Arabic: {key}")

# Save updates
with open('backend/agents/student/responses_tr.json', 'w', encoding='utf-8') as f:
    json.dump(tr_data, f, ensure_ascii=False, indent=2)

with open('backend/agents/student/responses_ar.json', 'w', encoding='utf-8') as f:
    json.dump(ar_data, f, ensure_ascii=False, indent=2)

print("\n✅ Turkish and Arabic translations added successfully!")
print(f"Turkish now has: {len(tr_data)} keys")
print(f"Arabic now has: {len(ar_data)} keys")
