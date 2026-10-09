import { Empty } from 'antd';

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">尚未接入</p>
          <h1 className="page-title">{title}</h1>
        </div>
      </header>
      <div className="panel empty-panel">
        <Empty description={description} />
      </div>
    </section>
  );
}
