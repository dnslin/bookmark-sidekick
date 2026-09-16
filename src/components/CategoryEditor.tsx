import { Plus, Trash2 } from 'lucide-react';

export function CategoryEditor({ categories, onChange }: { categories: string[]; onChange: (categories: string[]) => void }) {
  return <section className="category-editor" aria-labelledby="category-editor-heading">
    <div className="row-between"><h3 id="category-editor-heading">分类</h3><span>{categories.length} / 20</span></div>
    <p className="help">每行一个分类，名称中可以包含逗号等符号。模型只会从这些分类中选择。</p>
    <div className="category-editor-list">{categories.map((category, index) => <div className="category-editor-row" key={index}>
      <input aria-label={`分类 ${index + 1}`} value={category} maxLength={24} placeholder="输入分类名称" onChange={event => onChange(categories.map((item, i) => i === index ? event.target.value : item))}/>
      <button type="button" className="icon-button" aria-label={`删除分类 ${category || index + 1}`} disabled={categories.length === 1} onClick={() => onChange(categories.filter((_, i) => i !== index))}><Trash2 size={16}/></button>
    </div>)}</div>
    <button type="button" className="text-button category-add" disabled={categories.length >= 20} onClick={() => onChange([...categories, ''])}><Plus size={16}/>添加分类</button>
    <p className="help">修改列表不会重命名或合并已有书签的分类。</p>
  </section>;
}
