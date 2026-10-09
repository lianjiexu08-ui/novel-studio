import { useMemo, useState } from 'react';
import {
  App as AntApp, ConfigProvider, Layout, Menu, theme,
} from 'antd';
import {
  ArrowLeftOutlined, CheckCircleOutlined, ControlOutlined, DashboardOutlined, FileTextOutlined, FormOutlined,
  HomeOutlined, NodeIndexOutlined, SendOutlined, SettingOutlined, ToolOutlined,
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
import { OutlinePage } from './pages/OutlinePage';
import { OverviewPage } from './pages/OverviewPage';
import { useWorkChrome, WorkChromeContext } from './work-chrome';

const { Sider, Header, Content } = Layout;

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
  quality: '质量',
};

function workspaceNav(workId: string) {
  return [
    { key: '__back', icon: <ArrowLeftOutlined />, label: '返回书架' },
    { type: 'divider' as const },
    { key: `/works/${workId}/overview`, icon: <DashboardOutlined />, label: '概览' },
    { key: `/works/${workId}/covenant`, icon: <FormOutlined />, label: '约定' },
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

  const items = workId ? workspaceNav(workId) : TOP_NAV;
  const selected = workId
    ? (items.find((item) => 'key' in item && item.key !== '__back' && location.pathname.startsWith(String(item.key)))?.key ?? location.pathname)
    : (TOP_NAV.find((item) => item.key === location.pathname)?.key ?? '/');
  const label = sectionLabel(location.pathname, workId);

  return (
    <Layout className="ns-shell">
      <Sider className="ns-sider" width={228} theme="dark">
        <button type="button" className="brand" onClick={() => navigate('/')}>
          <span className="brand-seal">玄</span>
          <span className="brand-text">
            <span className="brand-name">Novel Studio</span>
            <span className="brand-sub">长篇自动创作</span>
          </span>
        </button>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[String(selected)]}
          onClick={({ key }) => navigate(key === '__back' ? '/' : key)}
          items={items}
        />
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
              <Route path="/tasks" element={<PlaceholderPage title="任务中心" description="后台任务、阶段、检查点、失败原因、重试、暂停和恢复 — 待实现（worker 包已有逻辑，待接入）" />} />
              <Route path="/publish" element={<PlaceholderPage title="发布" description="全作品存稿队列、排期、提交状态与核验 — 待实现" />} />
              <Route path="/system" element={<PlaceholderPage title="系统设置" description="模型 API 与密钥、模型角色分工、调用预算、平台连接、备份与恢复、紧急暂停 — 待实现" />} />
              <Route path="/works/:workId" element={<Workspace />}>
                <Route index element={<Navigate to="overview" replace />} />
                <Route path="overview" element={<OverviewPage />} />
                <Route path="covenant" element={<CovenantPage />} />
                <Route path="chapters" element={<ChaptersPage />} />
                <Route path="write" element={<WritePage />} />
                <Route path="settings" element={<BookSettingsPage />} />
                <Route path="outline" element={<OutlinePage />} />
                <Route path="quality" element={<PlaceholderPage title="质量" description="本书的硬冲突、语义疑点、检查覆盖与变更影响 — 待实现" />} />
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
