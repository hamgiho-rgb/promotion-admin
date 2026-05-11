// 옛 페이지 - /customers 로 리다이렉트 (App.tsx 에서 처리)
import { Navigate } from 'react-router-dom'
export default function Vendors() {
  return <Navigate to="/customers" replace />
}
