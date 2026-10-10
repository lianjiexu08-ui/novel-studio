import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  App as AntApp, ConfigProvider, Layout, Menu, theme,
} from 'antd';
import {
  ArrowLeftOutlined, CheckCircleOutlined, ControlOutlined, DashboardOutlined, FileTextOutlined, FormOutlined,
  HomeOutlined, MenuFoldOutlined, MenuUnfoldOutlined, NodeIndexOutlined, ProfileOutlined, SendOutlined, SettingOutlined, ToolOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { HashRouter, matchPath, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { BookshelfPage } from './pages/BookshelfPage';
import { CreateWorkPage } from './pages/CreateWorkPage';
import { CovenantPage } from './pages/CovenantPage';
import { Workspace } from './pages/Workspace';
import { ChaptersPage } from './pages/ChaptersPage';
import { WritePage } from './pages/WritePage';
import { BookSettingsPage } from './pages/BookSettingsPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { TasksPage } from './pages/TasksPage';
import { SystemPage } from './pages/SystemPage';
import { OutlinePage } from './pages/OutlinePage';
import { PlanPage } from './pages/PlanPage';
import { OverviewPage } from './pages/OverviewPage';
import { DesignPage } from './pages/DesignPage';
import { QualityPage } from './pages/QualityPage';
import { useWorkChrome, WorkChromeContext } from './work-chrome';

const { Sider, Header, Content } = Layout;

const SIDER_MIN = 180;
const SIDER_MAX = 420;
const SIDER_DEFAULT = 228;
const SIDER_COLLAPSED = 72;
const SIDER_WIDTH_KEY = 'ns.sider.width';
const SIDER_COLLAPSED_KEY = 'ns.sider.collapsed';

function storedSiderWidth(): number {
  const raw = Number(localStorage.getItem(SIDER_WIDTH_KEY));
  return Number.isFinite(raw) && raw >= SIDER_MIN && raw <= SIDER_MAX ? raw : SIDER_DEFAULT;
}

function storedSiderCollapsed(): boolean {
  const raw = localStorage.getItem(SIDER_COLLAPSED_KEY);
  if (raw === '1' || raw === '0') return raw === '1';
  return window.matchMedia('(max-width: 900px)').matches;
}

const TOP_NAV = [
  { key: '/', icon: <HomeOutlined />, label: '书架' },
  { key: '/tasks', icon: <ControlOutlined />, label: '任务中心' },
  { key: '/publish', icon: <SendOutlined />, label: '发布' },
  { key: '/system', icon: <ToolOutlined />, label: '系统设置' },
];

const SECTION_LABEL: Record<string, string> = {
  overview: '概览',
  covenant: '约定',
  chapters: '章节',
  write: '章节创作',
  settings: '设定',
  outline: '大纲',
  plan: '全书计划',
  quality: '质量',
  design: '世界构建',
};

function workspaceNav(workId: string) {
  return [
    { key: '__back', icon: <ArrowLeftOutlined />, label: '返回书架' },
    { type: 'divider' as const },
    { key: `/works/${workId}/overview`, icon: <DashboardOutlined />, label: '概览' },
    { key: `/works/${workId}/design`, icon: <NodeIndexOutlined />, label: '世界构建' },
    { key: `/works/${workId}/covenant`, icon: <FormOutlined />, label: '约定' },
    { key: `/works/${workId}/plan`, icon: <ProfileOutlined />, label: '全书计划' },
    { key: `/works/${workId}/chapters`, icon: <UnorderedListOutlined />, label: '章节' },
    { key: `/works/${workId}/write`, icon: <FileTextOutlined />, label: '章节创作' },
    { key: `/works/${workId}/settings`, icon: <SettingOutlined />, label: '设定' },
    { key: `/works/${workId}/outline`, icon: <NodeIndexOutlined />, label: '大纲' },
    { key: `/works/${workId}/quality`, icon: <CheckCircleOutlined />, label: '质量' },
  ];
}

function sectionLabel(pathname: string, workId?: string) {
  if (pathname === '/new') return '创作';
  if (!workId) return TOP_NAV.find((item) => item.key === pathname)?.label ?? '书架';
  const section = pathname.split('/').filter(Boolean).at(-1) ?? '';
  return SECTION_LABEL[section] ?? '创作空间';
}

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { title: workTitle } = useWorkChrome();
  const workspaceMatch = matchPath('/works/:workId/*', location.pathname);
  const workId = workspaceMatch?.params.workId;
  const [siderWidth, setSiderWidth] = useState(storedSiderWidth);
  const [siderCollapsed, setSiderCollapsed] = useState(storedSiderCollapsed);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    localStorage.setItem(SIDER_WIDTH_KEY, String(siderWidth));
  }, [siderWidth]);

  useEffect(() => {
    localStorage.setItem(SIDER_COLLAPSED_KEY, siderCollapsed ? '1' : '0');
  }, [siderCollapsed]);

  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = siderCollapsed ? SIDER_COLLAPSED : siderWidth;
    setDragging(true);
    const move = (next: PointerEvent) => {
      const delta = next.clientX - startX;
      if (siderCollapsed && delta < 16) return;
      const base = siderCollapsed ? SIDER_MIN - 16 : startWidth;
      setSiderCollapsed(false);
      setSiderWidth(Math.min(SIDER_MAX, Math.max(SIDER_MIN, base + delta)));
    };
    const stop = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  const items = workId ? workspaceNav(workId) : TOP_NAV;
  const selected = workId
    ? (items.find((item) => 'key' in item && item.key !== '__back' && location.pathname.startsWith(String(item.key)))?.key ?? location.pathname)
    : (TOP_NAV.find((item) => item.key === location.pathname)?.key ?? '/');
  const label = sectionLabel(location.pathname, workId);
  const siderSpace = siderCollapsed ? SIDER_COLLAPSED : siderWidth;

  return (
    <Layout className={`ns-shell${dragging ? ' is-resizing-sider' : ''}`} style={{ marginLeft: siderSpace }}>
      <Sider className="ns-sider" width={siderWidth} collapsedWidth={SIDER_COLLAPSED} collapsed={siderCollapsed} trigger={null} theme="dark">
        <button type="button" className="brand" onClick={() => navigate('/')} title="Novel Studio">
          <span className="brand-seal">玄</span>
          {!siderCollapsed && (
            <span className="brand-text">
              <span className="brand-name">Novel Studio</span>
              <span className="brand-sub">长篇自动创作</span>
            </span>
          )}
        </button>
        <Menu
          theme="dark"
          mode="inline"
          inlineCollapsed={siderCollapsed}
          selectedKeys={[String(selected)]}
          onClick={({ key }) => navigate(key === '__back' ? '/' : key)}
          items={items}
        />
        <button type="button" className="sider-collapse" onClick={() => setSiderCollapsed((collapsed) => !collapsed)} aria-label={siderCollapsed ? '展开导航' : '折叠导航'}>
          {siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          {!siderCollapsed && <span>折叠</span>}
        </button>
        <button type="button" className={`sider-resize${dragging ? ' is-dragging' : ''}`} aria-label="拖拽调整导航宽度" onPointerDown={startResize} />
      </Sider>

      <Layout className="ns-main" style={{ background: 'transparent' }}>
        <Header className="ns-header">
          <div className="crumb">
            {workId ? <>创作空间<span>  ·  </span><strong>{label}</strong></> : <strong>{label}</strong>}
          </div>
          {workId && (
            <div className="work-chip" title={workTitle ?? workId}>
              <span className="work-chip-mark">书</span>
              <span className="work-chip-title">{workTitle ?? '加载作品…'}</span>
            </div>
          )}
        </Header>

        <Content>
          <div className="ns-content">
            <Routes>
              <Route path="/" element={<BookshelfPage />} />
              <Route path="/new" element={<CreateWorkPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/publish" element={<PlaceholderPage title="发布" description="全作品存稿队列、排期、提交状态与核验 — 待实现" />} />
              <Route path="/system" element={<SystemPage />} />
              <Route path="/works/:workId" element={<Workspace />}>
                <Route index element={<Navigate to="overview" replace />} />
                <Route path="overview" element={<OverviewPage />} />
                <Route path="design" element={<DesignPage />} />
                <Route path="covenant" element={<CovenantPage />} />
                <Route path="chapters" element={<ChaptersPage />} />
                <Route path="write" element={<WritePage />} />
                <Route path="settings" element={<BookSettingsPage />} />
                <Route path="plan" element={<PlanPage />} />
                <Route path="outline" element={<OutlinePage />} />
                <Route path="quality" element={<QualityPage />} />
              </Route>
            </Routes>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}

export function App() {
  const [title, setTitle] = useState<string | null>(null);
  const chrome = useMemo(() => ({ title, setTitle }), [title]);

  return (
    <WorkChromeContext.Provider value={chrome}>
      <ConfigProvider
        theme={{
          algorithm: theme.darkAlgorithm,
          token: {
            colorPrimary: '#d7b074',
            colorInfo: '#d7b074',
            colorSuccess: '#7d9a74',
            colorWarning: '#d7b074',
            colorError: '#d37a62',
            colorBgBase: '#100f0d',
            colorBgContainer: '#1c1a16',
            colorBgElevated: '#24211c',
            colorBorder: '#3a342c',
            colorText: '#f4efe6',
            colorTextSecondary: '#a3988c',
            colorTextTertiary: '#7d756c',
            borderRadius: 10,
            fontFamily: "'Segoe UI','PingFang SC','Microsoft YaHei UI','Microsoft YaHei',sans-serif",
          },
          components: {
            Layout: { siderBg: '#141310', headerBg: 'transparent', bodyBg: 'transparent' },
            Menu: {
              darkItemBg: 'transparent',
              darkItemColor: '#c9c0b4',
              darkItemHoverColor: '#f4efe6',
              darkItemSelectedColor: '#f8edd8',
              darkItemSelectedBg: 'rgba(215,176,116,0.14)',
              darkItemHoverBg: 'rgba(255,255,255,0.04)',
              itemBorderRadius: 10,
              itemMarginInline: 12,
              itemHeight: 42,
            },
            Button: {
              primaryColor: '#1c1408',
              primaryShadow: 'none',
              defaultShadow: 'none',
              defaultBg: 'transparent',
              defaultBorderColor: '#3a342c',
              fontWeight: 600,
            },
            Card: { colorBorderSecondary: '#3a342c' },
            Table: {
              headerBg: 'transparent',
              headerColor: '#a3988c',
              headerSplitColor: 'transparent',
              borderColor: '#3a342c',
              rowHoverBg: 'rgba(215,176,116,0.06)',
            },
            Modal: { contentBg: '#1c1a16', headerBg: '#1c1a16' },
            Tabs: { inkBarColor: '#d7b074', itemSelectedColor: '#f4efe6', itemColor: '#a3988c' },
          },
        }}
      >
        <AntApp message={{ top: 84 }}>
          <HashRouter>
            <Shell />
          </HashRouter>
        </AntApp>
      </ConfigProvider>
    </WorkChromeContext.Provider>
  );
}
