import { Empty, Tabs } from 'antd';

/** Book-scoped settings: relationships, worldview, power system. */
export function BookSettingsPage() {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">本书</p>
          <h1 className="page-title">设定</h1>
          <p className="page-desc">人物、世界与力量体系只作用于当前作品。</p>
        </div>
      </header>
      <div className="panel">
        <Tabs
          className="ns-tabs"
          items={[
            { key: 'characters', label: '人物关系', children: <Empty description="人物、血缘身份、单向信任与情绪、锁定关系 — 待实现" /> },
            { key: 'world', label: '世界观', children: <Empty description="世界规则、地理、时间线 — 待实现" /> },
            { key: 'power', label: '力量体系', children: <Empty description="境界、功法、法宝与玄幻 Obligation（誓约/承诺/期限）— 待实现" /> },
          ]}
        />
      </div>
    </section>
  );
}
