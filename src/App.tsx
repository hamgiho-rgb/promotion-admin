import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/components/Layout'
import PinGate from '@/components/PinGate'
import Dashboard from '@/pages/Dashboard'
import Customers from '@/pages/Customers'
import Suppliers from '@/pages/Suppliers'
import Products from '@/pages/Products'
import ProductDetail from '@/pages/ProductDetail'
import CostBreakdown from '@/pages/CostBreakdown'
import CostBreakdownPrint from '@/pages/CostBreakdownPrint'
import Fabric from '@/pages/Fabric'
import IncomingPage from '@/pages/Incoming'
import IncomingPrint from '@/pages/IncomingPrint'
import InvoicesPage from '@/pages/Invoices'
import InvoicePrint from '@/pages/InvoicePrint'
import InvoiceStatement from '@/pages/InvoiceStatement'
import QuotationsPage from '@/pages/Quotations'
import QuotationPrint from '@/pages/QuotationPrint'
import MarginReport from '@/pages/MarginReport'
import DataImport from '@/pages/DataImport'
import Settings from '@/pages/Settings'
import SupplierPayments from '@/pages/SupplierPayments'
import SupplierInvoices from '@/pages/SupplierInvoices'
import SupplierInvoicePrint from '@/pages/SupplierInvoicePrint'
import Trash from '@/pages/Trash'
import ActivityLogs from '@/pages/ActivityLogs'

export default function App() {
  return (
    <PinGate>
    <Routes>
      {/* 인쇄 화면은 사이드바 없이 단독 */}
      <Route path="/invoices/:id/print"   element={<InvoicePrint />} />
      <Route path="/quotations/:id/print" element={<QuotationPrint />} />
      <Route path="/incoming/:id/print"   element={<IncomingPrint />} />
      <Route path="/supplier-invoices/:id/print" element={<SupplierInvoicePrint />} />
      <Route path="/cost/:productId/print" element={<CostBreakdownPrint />} />
      <Route path="/invoices/statement" element={<InvoiceStatement />} />

      {/* 그 외에는 사이드바 레이아웃 */}
      <Route path="/*" element={
        <Layout>
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="customers"  element={<Customers />} />
            <Route path="suppliers"  element={<Suppliers />} />
            <Route path="vendors"    element={<Navigate to="/customers" replace />} />
            <Route path="products"      element={<Products />} />
            <Route path="products/:id"  element={<ProductDetail />} />
            <Route path="cost"       element={<CostBreakdown />} />
            <Route path="fabric"     element={<Fabric />} />
            <Route path="quotations" element={<QuotationsPage />} />
            <Route path="incoming"   element={<IncomingPage />} />
            <Route path="invoices"   element={<InvoicesPage />} />
            <Route path="margin"     element={<MarginReport />} />
            <Route path="payments"   element={<SupplierPayments />} />
            <Route path="supplier-invoices" element={<SupplierInvoices />} />
            <Route path="import"     element={<DataImport />} />
            <Route path="trash"      element={<Trash />} />
            <Route path="logs"       element={<ActivityLogs />} />
            <Route path="settings"   element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      } />
    </Routes>
    </PinGate>
  )
}
