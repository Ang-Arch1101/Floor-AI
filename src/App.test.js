import { render, screen } from '@testing-library/react';
import App from './App';

// Smoke test：App 能在 jsdom 渲染出三區 UI（Ribbon / 性質面板 / 狀態列）
test('renders ribbon, properties panel and export button', () => {
  render(<App />);
  expect(screen.getByText('牆 [W]')).toBeInTheDocument();
  expect(screen.getByText('性質')).toBeInTheDocument();
  expect(screen.getByText('匯入 DXF')).toBeInTheDocument();
  expect(screen.getByText('匯出 DXF')).toBeInTheDocument();
});
