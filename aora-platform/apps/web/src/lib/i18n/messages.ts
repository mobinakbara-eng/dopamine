import type { SupportedLocale } from "@/lib/i18n/config";

export interface Messages {
  appName: string;
  owner: string;
  manager: string;
  employee: string;
  stores: string;
  managers: string;
  employees: string;
  invitations: string;
  createStore: string;
  inviteManager: string;
  inviteEmployee: string;
  storeName: string;
  storeSlug: string;
  city: string;
  postalCode: string;
  address: string;
  country: string;
  timezone: string;
  email: string;
  fullName: string;
  jobTitle: string;
  sendInvitation: string;
  pending: string;
  active: string;
  previewMode: string;
  liveMode: string;
  ownerIntro: string;
  managerIntro: string;
  employeeIntro: string;
  noData: string;
  success: string;
  error: string;
  submit: string;
  acceptingInvitation: string;
  acceptInvitation: string;
}

const messages: Record<SupportedLocale, Messages> = {
  de: {
    appName: "Aora Workforce",
    owner: "Inhaber",
    manager: "Arbeitgeber / Manager",
    employee: "Mitarbeiter",
    stores: "Standorte",
    managers: "Manager",
    employees: "Mitarbeiter",
    invitations: "Einladungen",
    createStore: "Standort erstellen",
    inviteManager: "Manager einladen",
    inviteEmployee: "Mitarbeiter einladen",
    storeName: "Name des Standorts",
    storeSlug: "URL-Kürzel",
    city: "Stadt",
    postalCode: "Postleitzahl",
    address: "Adresse",
    country: "Land",
    timezone: "Zeitzone",
    email: "E-Mail-Adresse",
    fullName: "Vollständiger Name",
    jobTitle: "Position",
    sendInvitation: "Einladung senden",
    pending: "Ausstehend",
    active: "Aktiv",
    previewMode: "Vorschaumodus",
    liveMode: "Live-Daten",
    ownerIntro: "Erstellen Sie Standorte, weisen Sie Manager zu und behalten Sie die gesamte Organisation im Blick.",
    managerIntro: "Verwalten Sie ausschließlich die Ihnen zugewiesenen Standorte und deren Teams.",
    employeeIntro: "Ihre Schicht, Zeiterfassung und offenen Aufgaben auf einen Blick.",
    noData: "Noch keine Daten vorhanden.",
    success: "Erfolgreich gespeichert.",
    error: "Die Aktion konnte nicht abgeschlossen werden.",
    submit: "Speichern",
    acceptingInvitation: "Einladung wird geprüft",
    acceptInvitation: "Einladung annehmen",
  },
  en: {
    appName: "Aora Workforce",
    owner: "Owner",
    manager: "Manager",
    employee: "Employee",
    stores: "Stores",
    managers: "Managers",
    employees: "Employees",
    invitations: "Invitations",
    createStore: "Create store",
    inviteManager: "Invite manager",
    inviteEmployee: "Invite employee",
    storeName: "Store name",
    storeSlug: "URL slug",
    city: "City",
    postalCode: "Postal code",
    address: "Address",
    country: "Country",
    timezone: "Timezone",
    email: "Email address",
    fullName: "Full name",
    jobTitle: "Job title",
    sendInvitation: "Send invitation",
    pending: "Pending",
    active: "Active",
    previewMode: "Preview mode",
    liveMode: "Live data",
    ownerIntro: "Create stores, assign managers and oversee the whole organization.",
    managerIntro: "Manage only the stores and teams assigned to you.",
    employeeIntro: "See your shift, clock state and open tasks at a glance.",
    noData: "No data yet.",
    success: "Saved successfully.",
    error: "The action could not be completed.",
    submit: "Save",
    acceptingInvitation: "Checking invitation",
    acceptInvitation: "Accept invitation",
  },
  fa: {
    appName: "Aora Workforce",
    owner: "مالک",
    manager: "مدیر فروشگاه",
    employee: "کارمند",
    stores: "فروشگاه‌ها",
    managers: "مدیران",
    employees: "کارمندان",
    invitations: "دعوت‌ها",
    createStore: "ساخت فروشگاه",
    inviteManager: "دعوت مدیر",
    inviteEmployee: "دعوت کارمند",
    storeName: "نام فروشگاه",
    storeSlug: "آدرس کوتاه",
    city: "شهر",
    postalCode: "کد پستی",
    address: "آدرس",
    country: "کشور",
    timezone: "منطقه زمانی",
    email: "ایمیل",
    fullName: "نام کامل",
    jobTitle: "عنوان شغلی",
    sendInvitation: "ارسال دعوت",
    pending: "در انتظار",
    active: "فعال",
    previewMode: "حالت پیش‌نمایش",
    liveMode: "داده زنده",
    ownerIntro: "فروشگاه بسازید، مدیر تعیین کنید و کل سازمان را کنترل کنید.",
    managerIntro: "فقط فروشگاه‌ها و تیم‌های اختصاص‌داده‌شده به خودتان را مدیریت کنید.",
    employeeIntro: "شیفت، وضعیت حضور و وظایف باز خود را یکجا ببینید.",
    noData: "هنوز داده‌ای وجود ندارد.",
    success: "با موفقیت ذخیره شد.",
    error: "انجام عملیات ممکن نبود.",
    submit: "ذخیره",
    acceptingInvitation: "در حال بررسی دعوت",
    acceptInvitation: "پذیرفتن دعوت",
  },
  tr: {
    appName: "Aora Workforce",
    owner: "İşletme sahibi",
    manager: "Mağaza yöneticisi",
    employee: "Çalışan",
    stores: "Mağazalar",
    managers: "Yöneticiler",
    employees: "Çalışanlar",
    invitations: "Davetler",
    createStore: "Mağaza oluştur",
    inviteManager: "Yönetici davet et",
    inviteEmployee: "Çalışan davet et",
    storeName: "Mağaza adı",
    storeSlug: "URL kısaltması",
    city: "Şehir",
    postalCode: "Posta kodu",
    address: "Adres",
    country: "Ülke",
    timezone: "Saat dilimi",
    email: "E-posta adresi",
    fullName: "Ad soyad",
    jobTitle: "Görev",
    sendInvitation: "Davet gönder",
    pending: "Bekliyor",
    active: "Aktif",
    previewMode: "Önizleme modu",
    liveMode: "Canlı veri",
    ownerIntro: "Mağazalar oluşturun, yöneticiler atayın ve tüm organizasyonu yönetin.",
    managerIntro: "Yalnızca size atanan mağazaları ve ekipleri yönetin.",
    employeeIntro: "Vardiyanızı, saat durumunuzu ve açık görevlerinizi görün.",
    noData: "Henüz veri yok.",
    success: "Başarıyla kaydedildi.",
    error: "İşlem tamamlanamadı.",
    submit: "Kaydet",
    acceptingInvitation: "Davet kontrol ediliyor",
    acceptInvitation: "Daveti kabul et",
  },
};

export function getMessages(locale: SupportedLocale): Messages {
  return messages[locale];
}
