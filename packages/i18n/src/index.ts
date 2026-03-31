// ============================================================
// @vierp/i18n — Vietnamese-first Internationalization Engine
// RRI-T Upgrade: End User Persona × D1 UI/UX × LOCALE Axis
// RRI-UX: Vietnamese-Specific UI Patterns (10 items)
//
// Fixes:
// - No i18n library → Lightweight translation engine
// - No translation strings → Full Vi/En message catalog
// - No diacritic-insensitive search → Vietnamese text utils
// - No VND/date/phone formatting → Locale-aware formatters
// ============================================================

// ─── Types ───────────────────────────────────────────────────

export type Locale = 'vi' | 'en';

export interface TranslationCatalog {
  [key: string]: string | TranslationCatalog;
}

export interface I18nConfig {
  defaultLocale: Locale;
  fallbackLocale: Locale;
  catalogs: Record<Locale, TranslationCatalog>;
}

// ─── Translation Engine ──────────────────────────────────────

export class I18n {
  private locale: Locale;
  private config: I18nConfig;

  constructor(config: I18nConfig) {
    this.config = config;
    this.locale = config.defaultLocale;
  }

  setLocale(locale: Locale): void {
    this.locale = locale;
  }

  getLocale(): Locale {
    return this.locale;
  }

  /**
   * Translate a key with optional interpolation
   * Usage: t('order.status.pending') → "Chờ xác nhận"
   *        t('error.minLength', { min: 8 }) → "Tối thiểu 8 ký tự"
   */
  t(key: string, params?: Record<string, string | number>): string {
    let value = this.resolve(key, this.locale);

    // Fallback to other locale
    if (!value && this.locale !== this.config.fallbackLocale) {
      value = this.resolve(key, this.config.fallbackLocale);
    }

    // Return key if not found
    if (!value) return key;

    // Interpolate {{param}} patterns
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
      }
    }

    return value;
  }

  private resolve(key: string, locale: Locale): string | undefined {
    const parts = key.split('.');
    let current: any = this.config.catalogs[locale];

    for (const part of parts) {
      if (!current || typeof current !== 'object') return undefined;
      current = current[part];
    }

    return typeof current === 'string' ? current : undefined;
  }
}

// ─── Vietnamese Translation Catalog ──────────────────────────

const VI: TranslationCatalog = {
  common: {
    save: 'Lưu',
    cancel: 'Hủy',
    delete: 'Xóa',
    edit: 'Sửa',
    create: 'Tạo mới',
    search: 'Tìm kiếm',
    filter: 'Lọc',
    export: 'Xuất',
    import: 'Nhập',
    loading: 'Đang tải...',
    confirm: 'Xác nhận',
    back: 'Quay lại',
    next: 'Tiếp theo',
    previous: 'Trước đó',
    submit: 'Gửi',
    reset: 'Đặt lại',
    close: 'Đóng',
    yes: 'Có',
    no: 'Không',
    all: 'Tất cả',
    none: 'Không có',
    noData: 'Không có dữ liệu',
    noResults: 'Không tìm thấy kết quả',
    success: 'Thành công',
    error: 'Lỗi',
    warning: 'Cảnh báo',
    info: 'Thông tin',
    actions: 'Thao tác',
    status: 'Trạng thái',
    createdAt: 'Ngày tạo',
    updatedAt: 'Ngày cập nhật',
    page: 'Trang',
    of: 'của',
    showing: 'Hiển thị',
    records: 'bản ghi',
  },

  auth: {
    login: 'Đăng nhập',
    logout: 'Đăng xuất',
    register: 'Đăng ký',
    forgotPassword: 'Quên mật khẩu',
    resetPassword: 'Đặt lại mật khẩu',
    email: 'Email',
    password: 'Mật khẩu',
    rememberMe: 'Ghi nhớ đăng nhập',
    loginFailed: 'Đăng nhập thất bại. Vui lòng kiểm tra email và mật khẩu.',
    sessionExpired: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    unauthorized: 'Vui lòng đăng nhập để tiếp tục',
    forbidden: 'Bạn không có quyền thực hiện thao tác này',
  },

  validation: {
    required: 'Trường này là bắt buộc',
    email: 'Email không hợp lệ',
    phone: 'Số điện thoại không hợp lệ',
    taxCode: 'Mã số thuế không hợp lệ',
    minLength: 'Tối thiểu {{min}} ký tự',
    maxLength: 'Tối đa {{max}} ký tự',
    minValue: 'Giá trị tối thiểu là {{min}}',
    maxValue: 'Giá trị tối đa là {{max}}',
    passwordWeak: 'Mật khẩu cần ít nhất 1 chữ hoa, 1 chữ thường, 1 số và 1 ký tự đặc biệt',
    dateInvalid: 'Ngày không hợp lệ (DD/MM/YYYY)',
    numberInvalid: 'Giá trị số không hợp lệ',
    unique: '{{field}} đã tồn tại',
    mismatch: '{{field}} không khớp',
  },

  order: {
    status: {
      PENDING: 'Chờ xác nhận',
      CONFIRMED: 'Đã xác nhận',
      PROCESSING: 'Đang xử lý',
      SHIPPED: 'Đang giao hàng',
      DELIVERED: 'Đã giao hàng',
      COMPLETED: 'Hoàn thành',
      CANCELLED: 'Đã hủy',
      REFUNDED: 'Đã hoàn tiền',
      RETURNED: 'Trả hàng',
    },
  },

  accounting: {
    journal: 'Bút toán',
    debit: 'Nợ',
    credit: 'Có',
    balance: 'Số dư',
    trialBalance: 'Bảng cân đối phát sinh',
    balanceSheet: 'Bảng cân đối kế toán',
    incomeStatement: 'Báo cáo kết quả kinh doanh',
    cashFlow: 'Báo cáo lưu chuyển tiền tệ',
    fiscalYear: 'Năm tài chính',
    fiscalPeriod: 'Kỳ kế toán',
    chartOfAccounts: 'Hệ thống tài khoản',
    imbalanceError: 'Bút toán không cân: Nợ {{debit}} ≠ Có {{credit}}',
    periodClosed: 'Kỳ kế toán {{period}} đã đóng',
    eInvoice: 'Hóa đơn điện tử',
    taxDeclaration: 'Tờ khai thuế',
  },

  hrm: {
    employee: 'Nhân viên',
    department: 'Phòng ban',
    position: 'Chức vụ',
    salary: 'Lương',
    payroll: 'Bảng lương',
    leave: 'Nghỉ phép',
    attendance: 'Chấm công',
    insurance: 'Bảo hiểm',
    bhxh: 'BHXH',
    bhyt: 'BHYT',
    bhtn: 'BHTN',
  },

  ecommerce: {
    product: 'Sản phẩm',
    cart: 'Giỏ hàng',
    checkout: 'Thanh toán',
    order: 'Đơn hàng',
    shipping: 'Giao hàng',
    payment: 'Thanh toán',
    coupon: 'Mã giảm giá',
    outOfStock: 'Hết hàng',
    addToCart: 'Thêm vào giỏ',
    cod: 'Thanh toán khi nhận hàng',
    bankTransfer: 'Chuyển khoản ngân hàng',
    promotionExpired: 'Mã giảm giá đã hết hạn',
    minOrderAmount: 'Đơn hàng tối thiểu {{amount}} để áp dụng',
  },

  notification: {
    title: 'Thông báo',
    markAllRead: 'Đánh dấu tất cả đã đọc',
    noNotifications: 'Không có thông báo mới',
    invoiceOverdue: 'Hóa đơn {{number}} đã quá hạn {{days}} ngày',
    leaveApproved: 'Đơn nghỉ phép từ {{from}} đến {{to}} đã được duyệt',
    lowStock: 'Sản phẩm "{{product}}" sắp hết hàng (còn {{quantity}})',
  },
};

const EN: TranslationCatalog = {
  common: {
    save: 'Save', cancel: 'Cancel', delete: 'Delete', edit: 'Edit',
    create: 'Create', search: 'Search', filter: 'Filter',
    export: 'Export', import: 'Import', loading: 'Loading...',
    confirm: 'Confirm', back: 'Back', next: 'Next', previous: 'Previous',
    submit: 'Submit', reset: 'Reset', close: 'Close',
    yes: 'Yes', no: 'No', all: 'All', none: 'None',
    noData: 'No data', noResults: 'No results found',
    success: 'Success', error: 'Error', warning: 'Warning', info: 'Info',
    actions: 'Actions', status: 'Status',
    createdAt: 'Created', updatedAt: 'Updated',
    page: 'Page', of: 'of', showing: 'Showing', records: 'records',
  },
  auth: {
    login: 'Login', logout: 'Logout', register: 'Register',
    forgotPassword: 'Forgot password', resetPassword: 'Reset password',
    email: 'Email', password: 'Password', rememberMe: 'Remember me',
    loginFailed: 'Login failed. Please check your email and password.',
    sessionExpired: 'Session expired. Please login again.',
    unauthorized: 'Please login to continue',
    forbidden: 'You do not have permission to perform this action',
  },
  validation: {
    required: 'This field is required',
    email: 'Invalid email', phone: 'Invalid phone number',
    taxCode: 'Invalid tax code',
    minLength: 'Minimum {{min}} characters', maxLength: 'Maximum {{max}} characters',
    minValue: 'Minimum value is {{min}}', maxValue: 'Maximum value is {{max}}',
    passwordWeak: 'Password needs at least 1 uppercase, 1 lowercase, 1 number and 1 special character',
    dateInvalid: 'Invalid date (DD/MM/YYYY)', numberInvalid: 'Invalid number',
    unique: '{{field}} already exists', mismatch: '{{field}} does not match',
  },
  order: {
    status: {
      PENDING: 'Pending', CONFIRMED: 'Confirmed', PROCESSING: 'Processing',
      SHIPPED: 'Shipped', DELIVERED: 'Delivered', COMPLETED: 'Completed',
      CANCELLED: 'Cancelled', REFUNDED: 'Refunded', RETURNED: 'Returned',
    },
  },
  accounting: {
    journal: 'Journal Entry', debit: 'Debit', credit: 'Credit', balance: 'Balance',
    trialBalance: 'Trial Balance', balanceSheet: 'Balance Sheet',
    incomeStatement: 'Income Statement', cashFlow: 'Cash Flow Statement',
    fiscalYear: 'Fiscal Year', fiscalPeriod: 'Fiscal Period',
    chartOfAccounts: 'Chart of Accounts',
    imbalanceError: 'Journal imbalanced: Debit {{debit}} ≠ Credit {{credit}}',
    periodClosed: 'Period {{period}} is closed',
    eInvoice: 'E-Invoice', taxDeclaration: 'Tax Declaration',
  },
  hrm: {
    employee: 'Employee', department: 'Department', position: 'Position',
    salary: 'Salary', payroll: 'Payroll', leave: 'Leave',
    attendance: 'Attendance', insurance: 'Insurance',
    bhxh: 'Social Insurance', bhyt: 'Health Insurance', bhtn: 'Unemployment Insurance',
  },
  ecommerce: {
    product: 'Product', cart: 'Cart', checkout: 'Checkout', order: 'Order',
    shipping: 'Shipping', payment: 'Payment', coupon: 'Coupon',
    outOfStock: 'Out of stock', addToCart: 'Add to cart',
    cod: 'Cash on delivery', bankTransfer: 'Bank transfer',
    promotionExpired: 'Promotion code has expired',
    minOrderAmount: 'Minimum order {{amount}} required',
  },
  notification: {
    title: 'Notifications', markAllRead: 'Mark all read',
    noNotifications: 'No new notifications',
    invoiceOverdue: 'Invoice {{number}} is {{days}} days overdue',
    leaveApproved: 'Leave request from {{from}} to {{to}} has been approved',
    lowStock: 'Product "{{product}}" is low on stock ({{quantity}} remaining)',
  },
};

// ─── Vietnamese Text Utilities ───────────────────────────────

/**
 * Remove Vietnamese diacritics for search
 * "Nguyễn" → "Nguyen", "Thành phố Hồ Chí Minh" → "Thanh pho Ho Chi Minh"
 */
export function removeDiacritics(text: string): string {
  const map: Record<string, string> = {
    'à': 'a', 'á': 'a', 'ả': 'a', 'ã': 'a', 'ạ': 'a',
    'ă': 'a', 'ằ': 'a', 'ắ': 'a', 'ẳ': 'a', 'ẵ': 'a', 'ặ': 'a',
    'â': 'a', 'ầ': 'a', 'ấ': 'a', 'ẩ': 'a', 'ẫ': 'a', 'ậ': 'a',
    'è': 'e', 'é': 'e', 'ẻ': 'e', 'ẽ': 'e', 'ẹ': 'e',
    'ê': 'e', 'ề': 'e', 'ế': 'e', 'ể': 'e', 'ễ': 'e', 'ệ': 'e',
    'ì': 'i', 'í': 'i', 'ỉ': 'i', 'ĩ': 'i', 'ị': 'i',
    'ò': 'o', 'ó': 'o', 'ỏ': 'o', 'õ': 'o', 'ọ': 'o',
    'ô': 'o', 'ồ': 'o', 'ố': 'o', 'ổ': 'o', 'ỗ': 'o', 'ộ': 'o',
    'ơ': 'o', 'ờ': 'o', 'ớ': 'o', 'ở': 'o', 'ỡ': 'o', 'ợ': 'o',
    'ù': 'u', 'ú': 'u', 'ủ': 'u', 'ũ': 'u', 'ụ': 'u',
    'ư': 'u', 'ừ': 'u', 'ứ': 'u', 'ử': 'u', 'ữ': 'u', 'ự': 'u',
    'ỳ': 'y', 'ý': 'y', 'ỷ': 'y', 'ỹ': 'y', 'ỵ': 'y',
    'đ': 'd',
    'À': 'A', 'Á': 'A', 'Ả': 'A', 'Ã': 'A', 'Ạ': 'A',
    'Ă': 'A', 'Ằ': 'A', 'Ắ': 'A', 'Ẳ': 'A', 'Ẵ': 'A', 'Ặ': 'A',
    'Â': 'A', 'Ầ': 'A', 'Ấ': 'A', 'Ẩ': 'A', 'Ẫ': 'A', 'Ậ': 'A',
    'È': 'E', 'É': 'E', 'Ẻ': 'E', 'Ẽ': 'E', 'Ẹ': 'E',
    'Ê': 'E', 'Ề': 'E', 'Ế': 'E', 'Ể': 'E', 'Ễ': 'E', 'Ệ': 'E',
    'Ì': 'I', 'Í': 'I', 'Ỉ': 'I', 'Ĩ': 'I', 'Ị': 'I',
    'Ò': 'O', 'Ó': 'O', 'Ỏ': 'O', 'Õ': 'O', 'Ọ': 'O',
    'Ô': 'O', 'Ồ': 'O', 'Ố': 'O', 'Ổ': 'O', 'Ỗ': 'O', 'Ộ': 'O',
    'Ơ': 'O', 'Ờ': 'O', 'Ớ': 'O', 'Ở': 'O', 'Ỡ': 'O', 'Ợ': 'O',
    'Ù': 'U', 'Ú': 'U', 'Ủ': 'U', 'Ũ': 'U', 'Ụ': 'U',
    'Ư': 'U', 'Ừ': 'U', 'Ứ': 'U', 'Ử': 'U', 'Ữ': 'U', 'Ự': 'U',
    'Ỳ': 'Y', 'Ý': 'Y', 'Ỷ': 'Y', 'Ỹ': 'Y', 'Ỵ': 'Y',
    'Đ': 'D',
  };

  return text.split('').map(c => map[c] || c).join('');
}

/**
 * Diacritic-insensitive search
 * "nguyen" matches "Nguyễn", "thanh" matches "Thành"
 */
export function diacriticInsensitiveSearch(query: string, text: string): boolean {
  const normalizedQuery = removeDiacritics(query).toLowerCase();
  const normalizedText = removeDiacritics(text).toLowerCase();
  return normalizedText.includes(normalizedQuery);
}

/**
 * Format VND amount: 1234567 → "1.234.567 ₫"
 */
export function formatVND(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency', currency: 'VND',
    maximumFractionDigits: 0,
  }).format(num);
}

/**
 * Parse VND string: "1.234.567" → 1234567
 */
export function parseVND(text: string): number {
  return parseInt(text.replace(/[.\s₫đ,]/g, ''), 10) || 0;
}

/**
 * Format Vietnamese date: DD/MM/YYYY
 */
export function formatDateVN(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Format Vietnamese datetime: DD/MM/YYYY HH:mm
 */
export function formatDateTimeVN(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${formatDateVN(d)} ${hours}:${minutes}`;
}

/**
 * Format Vietnamese phone: 0912345678 → 0912 345 678
 */
export function formatPhoneVN(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`;
  }
  return phone;
}

/**
 * Vietnamese address formatter: Phường → Quận → Thành phố
 */
export function formatAddressVN(address: {
  street?: string; ward?: string; district?: string;
  city?: string; province?: string;
}): string {
  return [address.street, address.ward, address.district, address.city || address.province]
    .filter(Boolean)
    .join(', ');
}

// ─── Factory ─────────────────────────────────────────────────

export function createI18n(locale: Locale = 'vi'): I18n {
  return new I18n({
    defaultLocale: locale,
    fallbackLocale: 'vi',
    catalogs: { vi: VI, en: EN },
  });
}
