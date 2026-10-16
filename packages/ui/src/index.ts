// packages/ui: the IE Ledger design system. Components only, no app logic.
// Styles: import '@ie-ledger/ui/theme.css' after Tailwind (see src/styles/theme.css).

export { cx } from './lib/cx';

export {
  DEFAULT_LOCALE,
  formatMoney,
  formatMoneyToParts,
  parseMoneyInput,
  type FormatMoneyOptions,
  type ParseMoneyResult,
} from './money/format';

export { UiProvider, type UiProviderProps } from './components/provider/UiProvider';

export {
  Button,
  ButtonLink,
  buttonClass,
  type ButtonLinkProps,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './components/button/Button';
export {
  Description,
  FieldError,
  Input,
  Label,
  TextField,
  type FieldChromeProps,
  type TextFieldProps,
} from './components/field/Field';
export { Select, type SelectOption, type SelectProps } from './components/select/Select';
export { Combobox, type ComboboxProps } from './components/combobox/Combobox';
export {
  DatePicker,
  type DatePickerProps,
  type IsoDateString,
} from './components/date-picker/DatePicker';
export { MoneyInput, type MoneyInputProps } from './components/money/MoneyInput';
export { MoneyText, type MoneyTextProps } from './components/money/MoneyText';
export { Badge, type BadgeProps, type BadgeTone } from './components/badge/Badge';
export { Card } from './components/card/Card';
export { Dialog, DialogFooter, DialogTrigger, type DialogProps } from './components/dialog/Dialog';
export { Sheet, type SheetProps } from './components/sheet/Sheet';
export {
  Toaster,
  toast,
  toastQueue,
  type ToastContentValue,
  type ToastOptions,
  type ToastTone,
} from './components/toast/Toast';
export { Tab, TabList, TabPanel, Tabs } from './components/tabs/Tabs';
export { EmptyState, type EmptyStateProps } from './components/empty-state/EmptyState';
export {
  LoadingRegion,
  Skeleton,
  SkeletonText,
  type LoadingRegionProps,
  type SkeletonProps,
} from './components/skeleton/Skeleton';
export {
  DataTable,
  createDataTableColumns,
  dataTableFeatures,
  type ColumnFiltersState,
  type DataTableColumn,
  type DataTableColumnMeta,
  type DataTableFeatures,
  type DataTableProps,
  type SortingState,
} from './components/data-table/DataTable';
export { FileDropzone, type FileDropzoneProps } from './components/file-dropzone/FileDropzone';
export { Stepper, type StepperProps, type StepperStep } from './components/stepper/Stepper';
export {
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  type MenuItemProps,
  type MenuProps,
} from './components/menu/Menu';
export {
  AppShell,
  PageContainer,
  PageHeader,
  useShell,
  type AppShellProps,
  type PageHeaderProps,
} from './components/app-shell/AppShell';
export {
  SidebarNav,
  isNavItemActive,
  type NavItem,
  type NavSection,
  type SidebarNavProps,
} from './components/app-shell/SidebarNav';
export {
  OrgSwitcher,
  type OrgSummary,
  type OrgSwitcherProps,
} from './components/app-shell/OrgSwitcher';
export {
  UserMenu,
  type ThemePreference,
  type UserMenuProps,
} from './components/app-shell/UserMenu';
