// src/constants/categories.ts

export interface Category {
    value: string;
    label: string;
    subcategories?: { value: string; label: string }[];
}

export const categories: Category[] = [
    {
        value: "auto-services",
        label: "Avtomobil xidmətləri",
        subcategories: [
            { value: "evakuator", label: "Evakuator xidməti" },
            { value: "car-rental", label: "Avtomobil icarəsi" },
            { value: "qaldirici-icarəsi", label: "Qaldırıcı qurğuların icarəsi" },
            { value: "texnika-icarəsi", label: "Texnika icarəsi" },
            { value: "traveqo-kirayəsi", label: "Traveqo aylıq kirayəsi" },
            { value: "other-transport", label: "Digər Nəqliyyat xidmətləri" }
        ]
    },
    {
        value: "car-repair",
        label: "Avtomobil təmiri",
        subcategories: [
            { value: "car-key", label: "Avtomobil açar ustası" },
            { value: "car-repair", label: "Avtomobil təmiri ustası" },
            { value: "tyre-repair", label: "Təkər təmiri ustası" },
            { value: "car-paint", label: "Avtomobil Malyar ustası" },
            { value: "seat-upholstery", label: "Oturacaqların üzlənməsi" },
            { value: "car-cleaning", label: "Avtomobil təmizliyi" },
            { value: "other-car", label: "Digər avtomobil ustaları" }
        ]
    },
    {
        value: "beauty-health",
        label: "Gözəllik və Sağlamlıq",
        subcategories: [
            { value: "physiotherapy", label: "Fizioterapiya" },
            { value: "massage", label: "Masaj xidməti" },
            { value: "hairdresser", label: "Saç ustası" },
            { value: "laser", label: "Lazer epilyasiyası ustası" },
            { value: "makeup", label: "Makiyaj ustası" },
            { value: "nail", label: "Dırnaq ustası" },
            { value: "cleaning", label: "Təmizlik xidməti" },
            { value: "disinfection", label: "Dezinfeksiya xidməti" },
            { value: "other-health", label: "Digər Sağlamlıq ustaları" }
        ]
    },
    {
        value: "it-business",
        label: "İT, Biznes xidmətləri",
        subcategories: [
            { value: "computer", label: "Komputer ustası" },
            { value: "tv", label: "Televizor ustası" },
            { value: "camera", label: "Foto və Video aparatları" },
            { value: "tablet", label: "Planşet və elektron kitablar" },
            { value: "antenna", label: "Krosna antena ustası" },
            { value: "cctv", label: "Kamera ustası" },
            { value: "printer", label: "Printer ustası" },
            { value: "other-electronics", label: "Digər Elektronika ustaları" }
        ]
    },
    {
        value: "repair-construction",
        label: "Təmir və Tikinti",
        subcategories: [
            { value: "electric", label: "Elektrik" },
            { value: "cam-balkon", label: "Cam Balkon ustası" },
            { value: "plastic-windows", label: "Plastik Qapı Pəncərə" },
            { value: "shower-cabin", label: "Duş kabina" },
            { value: "jaluz", label: "Jaluz" },
            { value: "sewer", label: "Kanalizasiya ustası" },
            { value: "water-leak", label: "Su Sızma" },
            { value: "plumber", label: "Santexnik" },
            { value: "locksmith", label: "Çilingir, Açar ustası" },
            { value: "laminate", label: "Laminat-parket" },
            { value: "home-repair", label: "Ev təmiri" },
            { value: "stretch-ceiling", label: "Dartma tavan ustası" },
            { value: "wallpaper", label: "Divar kağızı ustası" },
            { value: "stucco", label: "Lepka ustası" },
            { value: "tile", label: "Kafel-metlax ustası" },
            { value: "painter", label: "Malyar ustası Ev" },
            { value: "tol", label: "Tol ustası" },
            { value: "railing", label: "Məhəccər" },
            { value: "auto-doors", label: "Avtomatik qapılar" },
            { value: "concrete", label: "Beton işləri" },
            { value: "sauna", label: "Sauna tikintisi" },
            { value: "a-frame", label: "A Frame evlərin tikintisi" },
            { value: "other-repair", label: "Digər Təmir ustaları" }
        ]
    },
    {
        value: "advertising-design",
        label: "Reklam və Dizayn",
        subcategories: [
            { value: "printing", label: "Çap işləri" },
            { value: "advertising", label: "Reklam xidmətləri" },
            { value: "interior-design", label: "İnteryer dizayn xidməti" },
            { value: "design", label: "Dizayn xidməti" },
            { value: "vinyl-banners", label: "Vinil bannerlər" },
            { value: "video", label: "Video xidmətləri" },
            { value: "photo", label: "Foto xidmətləri" },
            { value: "other-advertising", label: "Digər reklam ustaları" }
        ]
    },
    {
        value: "furniture-interior",
        label: "Mebel və İnteryer",
        subcategories: [
            { value: "kitchen", label: "Mətbəx mebeli quraşdırmaq" },
            { value: "vitrin", label: "Vitrin yığmaq" },
            { value: "sofa", label: "Divan və kreslo ustası" },
            { value: "office-furniture", label: "Ofis mebelləri" },
            { value: "furniture", label: "Mebel ustası" },
            { value: "other-furniture", label: "Digər mebel ustaları" }
        ]
    },
    {
        value: "home-appliances",
        label: "Məişət texnikası",
        subcategories: [
            { value: "ac", label: "Kondisioner ustası" },
            { value: "combi", label: "Kombi ustası" },
            { value: "fridge", label: "Soyuducu ustası" },
            { value: "washing-machine", label: "Paltaryuyan ustası" },
            { value: "dishwasher", label: "Qabyuyan ustası" },
            { value: "ariston", label: "Ariston ustası" },
            { value: "ventilation", label: "Havalandırma ustası" },
            { value: "pitiminiutka", label: "Pitiminiutka ustası" },
            { value: "gas", label: "Qaz ustası" },
            { value: "iran-peci", label: "İran peçi ustası" },
            { value: "stove", label: "Soba ustası" },
            { value: "water-filter", label: "Su filtri ustası" },
            { value: "vacuum", label: "Tozsoran ustası" },
            { value: "sewing-machine", label: "Tikiş maşını ustası" },
            { value: "other-appliances", label: "Digər Məişət Texnikası ustaları" }
        ]
    }
];

export const flatCategories = [
    { value: "", label: "Bütün kateqoriyalar" },
    ...categories.map((cat) => ({ value: cat.value, label: cat.label }))
];
