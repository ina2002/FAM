/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, Trash2, Calculator, ChevronRight, ChevronLeft, ChevronDown, 
  Info, AlertCircle, CheckCircle2, History, BookOpen, 
  Settings, Download, Share2, HelpCircle, X, 
  LayoutDashboard, Users, Layers, Target, BarChart3
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Expert, Attribute, Alternative, FAMData, FAMResult, AttributeRanking, AlternativeRanking, RatioInput, HistoryItem, FAMModelConfig } from './types';
import { solveFAM } from './solver';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';


const DEFAULT_CONFIG: FAMModelConfig = {
  alpha: 1,
  beta: 0.3,
  eta: 0.001,
  epsilon: 0.0001,
  phiTie: 0.03,
  phiSep: 0.05,
  lambda: 1,
  bigM: 1000,
  barM: 1,
  minLevels: 0,
};

export default function App() {
  const [step, setStep] = useState(1);
  const [experts, setExperts] = useState<Expert[]>([{ id: 'e1', name: '专家 1' }]);
  const [attributes, setAttributes] = useState<Attribute[]>([{ id: 'a1', name: '属性 1' }]);
  const [alternatives, setAlternatives] = useState<Alternative[]>([{ id: 'k1', name: '方案 1' }]);
  
  const [attributeRankings, setAttributeRankings] = useState<AttributeRanking[]>([]);
  const [alternativeRankings, setAlternativeRankings] = useState<AlternativeRanking[]>([]);
  const [ratios, setRatios] = useState<RatioInput[]>([]);
  const [config, setConfig] = useState<FAMModelConfig>(DEFAULT_CONFIG);
  
  const [result, setResult] = useState<FAMResult | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showFooterInfo, setShowFooterInfo] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('fam_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  const saveToHistory = (res: FAMResult) => {
    const newItem: HistoryItem = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      name: `分析报告 ${new Date().toLocaleString()}`,
      data: { experts, attributes, alternatives, attributeRankings, alternativeRankings, ratios, config },
      result: res
    };
    const updated = [newItem, ...history].slice(0, 10);
    setHistory(updated);
    localStorage.setItem('fam_history', JSON.stringify(updated));
  };

  const loadHistoryItem = (item: HistoryItem) => {
    setExperts(item.data.experts);
    setAttributes(item.data.attributes);
    setAlternatives(item.data.alternatives);
    setAttributeRankings(item.data.attributeRankings);
    setAlternativeRankings(item.data.alternativeRankings);
    setRatios(item.data.ratios);
    setConfig(item.data.config ? { ...DEFAULT_CONFIG, ...item.data.config } : DEFAULT_CONFIG);
    setResult(item.result);
    setStep(3);
    setShowHistory(false);
  };

  const addExpert = () => setExperts([...experts, { id: `e${experts.length + 1}`, name: `专家 ${experts.length + 1}` }]);
  const addAttribute = () => setAttributes([...attributes, { id: `a${attributes.length + 1}`, name: `属性 ${attributes.length + 1}` }]);
  const addAlternative = () => setAlternatives([...alternatives, { id: `k${alternatives.length + 1}`, name: `方案 ${alternatives.length + 1}` }]);

  const removeExpert = (id: string) => setExperts(experts.filter(e => e.id !== id));
  const removeAttribute = (id: string) => setAttributes(attributes.filter(a => a.id !== id));
  const removeAlternative = (id: string) => setAlternatives(alternatives.filter(a => a.id !== id));

  const handleExpertWeightChange = (id: string, weight: string) => {
    setExperts(experts.map(e => e.id === id ? { ...e, weight: weight === '' ? undefined : parseFloat(weight) } : e));
  };

  const normalizeExpertWeights = () => {
    const total = experts.reduce((sum, e) => sum + (e.weight || 0), 0);
    if (total === 0) {
      const equalWeight = 1 / experts.length;
      setExperts(experts.map(e => ({ ...e, weight: equalWeight })));
    } else {
      setExperts(experts.map(e => ({ ...e, weight: (e.weight || 0) / total })));
    }
  };

  const equalizeExpertWeights = () => {
    const equalWeight = 1 / experts.length;
    setExperts(experts.map(e => ({ ...e, weight: equalWeight })));
  };

  const handleAttributeRankChange = (expertId: string, attributeId: string, rank: string) => {
    const newRank = rank === '' ? undefined : parseInt(rank);
    const existing = attributeRankings.find(r => r.expertId === expertId && r.attributeId === attributeId);
    if (existing) {
      setAttributeRankings(attributeRankings.map(r => r.expertId === expertId && r.attributeId === attributeId ? { ...r, rank: newRank } : r));
    } else {
      setAttributeRankings([...attributeRankings, { expertId, attributeId, rank: newRank }]);
    }
  };

  const handleAlternativeRankChange = (expertId: string, attributeId: string, alternativeId: string, rank: string) => {
    const newRank = rank === '' ? undefined : parseInt(rank);
    const existing = alternativeRankings.find(r => r.expertId === expertId && r.attributeId === attributeId && r.alternativeId === alternativeId);
    if (existing) {
      setAlternativeRankings(alternativeRankings.map(r => r.expertId === expertId && r.attributeId === attributeId && r.alternativeId === alternativeId ? { ...r, rank: newRank } : r));
    } else {
      setAlternativeRankings([...alternativeRankings, { expertId, attributeId, alternativeId, rank: newRank }]);
    }
  };

  const addRatio = () => {
    setRatios([...ratios, { expertId: experts[0].id, attributeId: attributes[0].id, altKId: alternatives[0].id, altKPrimeId: alternatives[1]?.id || alternatives[0].id, ratio: 1 }]);
  };

  const removeRatio = (index: number) => setRatios(ratios.filter((_, i) => i !== index));


  const handleConfigChange = (key: keyof FAMModelConfig, value: string) => {
    const parsed = value === '' ? 0 : Number(value);
    setConfig((prev) => ({ ...prev, [key]: Number.isFinite(parsed) ? parsed : 0 }));
  };

  const handleCalculate = () => {
    setIsSolving(true);
    setError(null);
    setTimeout(() => {
      try {
        const res = solveFAM({
          experts,
          attributes,
          alternatives,
          attributeRankings,
          alternativeRankings,
          ratios,
          config
        });
        if (res) {
          setResult(res);
          saveToHistory(res);
          setStep(3);
        } else {
          setError("模型无可行解，请检查约束条件是否冲突。");
        }
      } catch (e) {
        setError("计算过程中发生错误。");
        console.error(e);
      } finally {
        setIsSolving(false);
      }
    }, 500);
  };

  const loadSampleData = () => {
    setConfig(DEFAULT_CONFIG);
    setExperts([
      { id: 'e1', name: '专家 A', weight: 0.6 },
      { id: 'e2', name: '专家 B', weight: 0.4 }
    ]);
    setAttributes([
      { id: 'a1', name: '成本' },
      { id: 'a2', name: '性能' },
      { id: 'a3', name: '可靠性' }
    ]);
    setAlternatives([
      { id: 'k1', name: '方案 X' },
      { id: 'k2', name: '方案 Y' },
      { id: 'k3', name: '方案 Z' }
    ]);
    setAttributeRankings([
      { expertId: 'e1', attributeId: 'a1', rank: 2 },
      { expertId: 'e1', attributeId: 'a2', rank: 1 },
      { expertId: 'e1', attributeId: 'a3', rank: 3 },
      { expertId: 'e2', attributeId: 'a1', rank: 1 },
      { expertId: 'e2', attributeId: 'a2', rank: 2 },
      { expertId: 'e2', attributeId: 'a3', rank: 3 }
    ]);
    setAlternativeRankings([
      { expertId: 'e1', attributeId: 'a1', alternativeId: 'k1', rank: 1 },
      { expertId: 'e1', attributeId: 'a1', alternativeId: 'k2', rank: 2 },
      { expertId: 'e1', attributeId: 'a1', alternativeId: 'k3', rank: 3 },
      { expertId: 'e1', attributeId: 'a2', alternativeId: 'k1', rank: 2 },
      { expertId: 'e1', attributeId: 'a2', alternativeId: 'k2', rank: 1 },
      { expertId: 'e1', attributeId: 'a2', alternativeId: 'k3', rank: 3 },
      { expertId: 'e1', attributeId: 'a3', alternativeId: 'k1', rank: 3 },
      { expertId: 'e1', attributeId: 'a3', alternativeId: 'k2', rank: 2 },
      { expertId: 'e1', attributeId: 'a3', alternativeId: 'k3', rank: 1 },
      { expertId: 'e2', attributeId: 'a1', alternativeId: 'k1', rank: 2 },
      { expertId: 'e2', attributeId: 'a1', alternativeId: 'k2', rank: 1 },
      { expertId: 'e2', attributeId: 'a1', alternativeId: 'k3', rank: 3 },
      { expertId: 'e2', attributeId: 'a2', alternativeId: 'k1', rank: 1 },
      { expertId: 'e2', attributeId: 'a2', alternativeId: 'k2', rank: 2 },
      { expertId: 'e2', attributeId: 'a2', alternativeId: 'k3', rank: 3 },
      { expertId: 'e2', attributeId: 'a3', alternativeId: 'k1', rank: 2 },
      { expertId: 'e2', attributeId: 'a3', alternativeId: 'k2', rank: 3 },
      { expertId: 'e2', attributeId: 'a3', alternativeId: 'k3', rank: 1 }
    ]);
  };

  const renderStep1 = () => (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">模型参数定义</h1>
          <p className="text-slate-500 mt-1">定义决策过程中的专家权重、属性分类以及方案设计。</p>
        </div>
        <button 
          onClick={loadSampleData}
          className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 bg-blue-50 px-4 py-2 rounded-full transition-all"
        >
          <BookOpen size={16} /> 加载示例数据
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <section className="bento-card group">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-blue-100 text-blue-600 p-2 rounded-2xl group-hover:scale-110 transition-transform">
                <Users size={20} />
              </div>
              <div>
                <p className="section-header">Step 01</p>
                <h2 className="text-lg font-bold">专家权重</h2>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={equalizeExpertWeights} 
                title="均分权重"
                className="p-2 bg-slate-50 text-slate-400 rounded-xl hover:bg-blue-50 hover:text-blue-600 transition-all"
              >
                <BarChart3 size={16} />
              </button>
              <button 
                onClick={normalizeExpertWeights} 
                title="归一化"
                className="p-2 bg-slate-50 text-slate-400 rounded-xl hover:bg-blue-50 hover:text-blue-600 transition-all"
              >
                <Target size={16} />
              </button>
              <button onClick={addExpert} className="p-2 bg-slate-50 text-slate-600 rounded-xl hover:bg-blue-50 hover:text-blue-600 transition-all">
                <Plus size={20} />
              </button>
            </div>
          </div>
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {experts.map((e) => (
              <div key={e.id} className="flex items-center gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-100 focus-within:border-blue-200 transition-all">
                <input 
                  value={e.name} 
                  onChange={(ev) => setExperts(experts.map(ex => ex.id === e.id ? { ...ex, name: ev.target.value } : ex))}
                  className="flex-1 bg-transparent border-none focus:ring-0 font-medium text-slate-700 text-sm"
                />
                <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-slate-100">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Weight</span>
                  <input 
                    type="number" 
                    step="0.01"
                    min="0"
                    max="1"
                    value={e.weight ?? ''} 
                    onChange={(ev) => handleExpertWeightChange(e.id, ev.target.value)}
                    className="w-12 text-center bg-transparent border-none focus:ring-0 text-xs font-bold"
                  />
                </div>
                {experts.length > 1 && (
                  <button onClick={() => removeExpert(e.id)} className="text-slate-300 hover:text-red-500 transition-colors p-1">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="bento-card group">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-100 text-emerald-600 p-2 rounded-2xl group-hover:scale-110 transition-transform">
                <Layers size={20} />
              </div>
              <div>
                <p className="section-header">Step 02</p>
                <h2 className="text-lg font-bold">属性分类</h2>
              </div>
            </div>
            <button onClick={addAttribute} className="p-2 bg-slate-50 text-slate-600 rounded-xl hover:bg-emerald-50 hover:text-emerald-600 transition-all">
              <Plus size={20} />
            </button>
          </div>
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {attributes.map((a) => (
              <div key={a.id} className="flex items-center gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-100 focus-within:border-emerald-200 transition-all">
                <input 
                  value={a.name} 
                  onChange={(ev) => setAttributes(attributes.map(ax => ax.id === a.id ? { ...ax, name: ev.target.value } : ax))}
                  className="flex-1 bg-transparent border-none focus:ring-0 font-medium text-slate-700 text-sm"
                />
                {attributes.length > 1 && (
                  <button onClick={() => removeAttribute(a.id)} className="text-slate-300 hover:text-red-500 transition-colors p-1">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="bento-card group">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-purple-100 text-purple-600 p-2 rounded-2xl group-hover:scale-110 transition-transform">
                <Target size={20} />
              </div>
              <div>
                <p className="section-header">Step 03</p>
                <h2 className="text-lg font-bold">方案设计</h2>
              </div>
            </div>
            <button onClick={addAlternative} className="p-2 bg-slate-50 text-slate-600 rounded-xl hover:bg-purple-50 hover:text-purple-600 transition-all">
              <Plus size={20} />
            </button>
          </div>
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {alternatives.map((k) => (
              <div key={k.id} className="flex items-center gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-100 focus-within:border-purple-200 transition-all">
                <input 
                  value={k.name} 
                  onChange={(ev) => setAlternatives(alternatives.map(kx => kx.id === k.id ? { ...kx, name: ev.target.value } : kx))}
                  className="flex-1 bg-transparent border-none focus:ring-0 font-medium text-slate-700 text-sm"
                />
                {alternatives.length > 1 && (
                  <button onClick={() => removeAlternative(k.id)} className="text-slate-300 hover:text-red-500 transition-colors p-1">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>


      <div className="bento-card">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-slate-100 text-slate-700 p-2 rounded-2xl">
            <Settings size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold">求解参数</h2>
            <p className="text-sm text-slate-500 mt-1">按照最新模型设置近并列阈值、分层阈值和目标权重。</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          {[
            { key: 'alpha', label: 'α', step: '0.1' },
            { key: 'beta', label: 'β', step: '0.1' },
            { key: 'eta', label: 'η', step: '0.001' },
            { key: 'phiTie', label: 'φ tie', step: '0.001' },
            { key: 'phiSep', label: 'φ sep', step: '0.001' },
            { key: 'epsilon', label: 'ε', step: '0.0001' },
            { key: 'lambda', label: 'λ', step: '0.1' },
            { key: 'bigM', label: 'M', step: '1' },
            { key: 'barM', label: 'M̄', step: '0.1' },
            { key: 'minLevels', label: 'L̲', step: '1' },
          ].map((item) => (
            <label key={item.key} className="bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 flex flex-col gap-2">
              <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400">{item.label}</span>
              <input
                type="number"
                step={item.step}
                value={config[item.key as keyof FAMModelConfig]}
                onChange={(ev) => handleConfigChange(item.key as keyof FAMModelConfig, ev.target.value)}
                className="bg-white border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-700 focus:ring-2 focus:ring-slate-400 outline-none"
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-4 leading-relaxed">
          当相邻排序位置差异不超过 φ tie 时，模型允许其归入同一层级；当差异至少达到 φ sep 时，模型判定其为不同层级。通常取 φ tie &lt; φ sep。
        </p>
      </div>

      <div className="flex justify-center pt-6">
        <button 
          onClick={() => setStep(2)}
          className="group flex items-center gap-3 bg-slate-900 text-white px-10 py-4 rounded-[2rem] font-bold hover:bg-blue-600 transition-all shadow-xl shadow-slate-200 hover:shadow-blue-200"
        >
          下一步：输入偏好信息 <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-10">
      <div className="flex items-center gap-4">
        <button onClick={() => setStep(1)} className="p-3 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 transition-all shadow-sm">
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">偏好信息输入</h1>
          <p className="text-slate-500 mt-1">输入专家对属性和方案的排序信息，也可补充相对重要性比值。空值将被视为未观测输入。</p>
        </div>
      </div>

      <div className="bg-blue-600 text-white p-6 rounded-[2rem] flex items-start gap-4 shadow-lg shadow-blue-100">
        <div className="bg-white/20 p-2 rounded-xl">
          <Info size={24} />
        </div>
        <div>
          <h3 className="font-bold text-lg">填写指南</h3>
          <p className="text-blue-100 text-sm mt-1 leading-relaxed">
            请在下方表格中输入排序值（1表示最重要或最优）。如果专家未提供某项信息，请保持输入框为空。系统将自动处理缺失数据。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        <section className="bento-card">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-amber-100 text-amber-600 p-2 rounded-2xl">
              <BarChart3 size={20} />
            </div>
            <h2 className="text-xl font-bold">属性分类重要性排序 (rij)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-y-2">
              <thead>
                <tr>
                  <th className="text-left py-3 px-4 text-slate-400 font-bold uppercase text-[10px] tracking-wider">专家 \ 属性分类</th>
                  {attributes.map(a => <th key={a.id} className="py-3 px-4 text-slate-700 font-bold">{a.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {experts.map(e => (
                  <tr key={e.id} className="group">
                    <td className="py-4 px-4 font-bold text-slate-600 bg-slate-50 rounded-l-2xl group-hover:bg-slate-100 transition-colors">{e.name}</td>
                    {attributes.map((a, idx) => (
                      <td key={a.id} className={`py-4 px-4 text-center bg-slate-50 group-hover:bg-slate-100 transition-colors ${idx === attributes.length - 1 ? 'rounded-r-2xl' : ''}`}>
                        <input 
                          type="number"
                          placeholder="-"
                          value={attributeRankings.find(r => r.expertId === e.id && r.attributeId === a.id)?.rank ?? ''}
                          onChange={(ev) => handleAttributeRankChange(e.id, a.id, ev.target.value)}
                          className="w-16 text-center bg-white border border-slate-200 rounded-xl py-2 font-bold text-blue-600 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bento-card">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-indigo-100 text-indigo-600 p-2 rounded-2xl">
              <LayoutDashboard size={20} />
            </div>
            <h2 className="text-xl font-bold">方案设计优劣排序 (rijk)</h2>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {experts.map(e => (
              <div key={e.id} className="border border-slate-100 rounded-[2rem] p-6 bg-slate-50/50">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                  <h3 className="font-bold text-slate-800">{e.name} 的判断</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                        <th className="text-left pb-4 font-bold">属性分类 \ 方案设计</th>
                        {alternatives.map(k => <th key={k.id} className="pb-4 font-bold text-center">{k.name}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {attributes.map(a => (
                        <tr key={a.id}>
                          <td className="py-3 pr-4 text-slate-600 font-medium">{a.name}</td>
                          {alternatives.map(k => (
                            <td key={k.id} className="py-3 px-2 text-center">
                              <input 
                                type="number"
                                placeholder="-"
                                value={alternativeRankings.find(r => r.expertId === e.id && r.attributeId === a.id && r.alternativeId === k.id)?.rank ?? ''}
                                onChange={(ev) => handleAlternativeRankChange(e.id, a.id, k.id, ev.target.value)}
                                className="w-16 text-center bg-white border border-slate-200 rounded-xl py-2 font-bold text-indigo-600 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bento-card">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-rose-100 text-rose-600 p-2 rounded-2xl">
                <Share2 size={20} />
              </div>
              <h2 className="text-xl font-bold">方案相对重要性比值 (tijkk')</h2>
            </div>
            <button onClick={addRatio} className="flex items-center gap-2 text-sm bg-slate-900 text-white px-4 py-2 rounded-full hover:bg-slate-800 transition-all font-bold">
              <Plus size={16} /> 添加比值约束
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ratios.map((r, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-3 p-4 bg-slate-50 rounded-[1.5rem] border border-slate-100 group">
                <select 
                  value={r.expertId} 
                  onChange={(e) => setRatios(ratios.map((rx, i) => i === idx ? { ...rx, expertId: e.target.value } : rx))}
                  className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-rose-500"
                >
                  {experts.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <span className="text-slate-400 text-[10px] font-bold uppercase">在</span>
                <select 
                  value={r.attributeId} 
                  onChange={(e) => setRatios(ratios.map((rx, i) => i === idx ? { ...rx, attributeId: e.target.value } : rx))}
                  className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-rose-500"
                >
                  {attributes.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <span className="text-slate-400 text-[10px] font-bold uppercase">下</span>
                <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-200">
                  <select 
                    value={r.altKId} 
                    onChange={(e) => setRatios(ratios.map((rx, i) => i === idx ? { ...rx, altKId: e.target.value } : rx))}
                    className="bg-transparent border-none focus:ring-0 text-xs font-bold text-slate-700"
                  >
                    {alternatives.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </select>
                  <span className="text-slate-300">/</span>
                  <select 
                    value={r.altKPrimeId} 
                    onChange={(e) => setRatios(ratios.map((rx, i) => i === idx ? { ...rx, altKPrimeId: e.target.value } : rx))}
                    className="bg-transparent border-none focus:ring-0 text-xs font-bold text-slate-700"
                  >
                    {alternatives.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </select>
                </div>
                <span className="text-slate-400 text-[10px] font-bold uppercase">=</span>
                <input 
                  type="number" 
                  step="0.1"
                  value={r.ratio} 
                  onChange={(e) => setRatios(ratios.map((rx, i) => i === idx ? { ...rx, ratio: parseFloat(e.target.value) } : rx))}
                  className="w-16 bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-bold text-center text-rose-600 focus:ring-2 focus:ring-rose-500 outline-none"
                />
                <button onClick={() => removeRatio(idx)} className="text-slate-300 hover:text-red-500 ml-auto p-1">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {ratios.length === 0 && (
              <div className="col-span-full py-12 text-center bg-slate-50 rounded-[2rem] border border-dashed border-slate-200">
                <p className="text-slate-400 text-sm italic">暂无比值约束，点击上方按钮添加</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {error && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-red-50 border border-red-200 p-6 rounded-[2rem] flex items-center gap-4 text-red-700 shadow-lg shadow-red-100"
        >
          <div className="bg-red-100 p-2 rounded-xl">
            <AlertCircle size={24} />
          </div>
          <div>
            <h4 className="font-bold">计算错误</h4>
            <p className="text-sm opacity-80">{error}</p>
          </div>
        </motion.div>
      )}

      <div className="flex justify-center pt-6">
        <button 
          onClick={handleCalculate}
          disabled={isSolving}
          className="group flex items-center gap-3 bg-blue-600 text-white px-12 py-5 rounded-[2.5rem] font-bold hover:bg-blue-700 transition-all shadow-2xl shadow-blue-200 disabled:opacity-50"
        >
          {isSolving ? (
            <span className="flex items-center gap-2">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
              >
                <Calculator size={24} />
              </motion.div>
              正在求解模型...
            </span>
          ) : (
            <>
              <Calculator size={24} /> 
              开始计算权重 
              <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </>
          )}
        </button>
      </div>
    </div>
  );

  const renderStep3 = () => {
    if (!result) return null;

    const chartData = result.ranking.map(r => ({
      name: alternatives.find(alt => alt.id === r.altId)?.name || r.altId,
      weight: parseFloat(r.weight.toFixed(4)),
      rank: r.rank,
      isTie: r.isTie
    }));

    return (
      <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <button onClick={() => setStep(2)} className="p-3 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 transition-all shadow-sm">
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">计算结果分析</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">模型已收敛</span>
                <span className="text-slate-400 text-xs font-mono">Obj = {result.objectiveValue.toFixed(6)}</span>
                <span className="text-slate-400 text-xs font-mono">dA = {result.dA.toFixed(6)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all">
              <Download size={16} /> 导出 PDF
            </button>
            <button className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100">
              <Share2 size={16} /> 分享报告
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 space-y-8">
            <section className="bento-card">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-100 text-blue-600 p-2 rounded-2xl">
                    <BarChart3 size={20} />
                  </div>
                  <h2 className="text-xl font-bold">方案综合权重分布</h2>
                </div>
              </div>
              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={1}/>
                        <stop offset="100%" stopColor="#2563eb" stopOpacity={0.8}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }} />
                    <Tooltip 
                      cursor={{ fill: '#f8fafc' }}
                      contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '12px' }}
                      itemStyle={{ fontWeight: 700, color: '#1e293b' }}
                    />
                    <Bar dataKey="weight" radius={[10, 10, 0, 0]} barSize={40}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index === 0 ? 'url(#barGradient)' : '#e2e8f0'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="bento-card">
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-emerald-100 text-emerald-600 p-2 rounded-2xl">
                  <CheckCircle2 size={20} />
                </div>
                <h2 className="text-xl font-bold">最终排名建议</h2>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {result.ranking.map((r, idx) => {
                  const alt = alternatives.find(a => a.id === r.altId);
                  const isTop = idx === 0;
                  return (
                    <motion.div 
                      key={r.altId}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className={`flex items-center gap-6 p-5 rounded-[2rem] border transition-all ${isTop ? 'bg-blue-600 border-blue-500 text-white shadow-xl shadow-blue-100' : 'bg-white border-slate-100 hover:border-slate-200'}`}
                    >
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-2xl ${isTop ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        {r.rank}
                      </div>
                      <div className="flex-1">
                        <div className={`text-lg font-bold ${isTop ? 'text-white' : 'text-slate-800'}`}>{alt?.name}</div>
                        <div className={`text-xs font-medium uppercase tracking-widest mt-1 ${isTop ? 'text-blue-100' : 'text-slate-400'}`}>
                          综合权重: {r.weight.toFixed(6)} · 层级 {r.level}
                        </div>
                      </div>
                      {r.isTie && (
                        <div className={`text-[10px] uppercase tracking-wider font-black px-3 py-1 rounded-full ${isTop ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'}`}>
                          同层
                        </div>
                      )}
                      {isTop && (
                        <div className="bg-white/20 p-2 rounded-full">
                          <Target size={24} />
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </section>
          </div>

          <div className="lg:col-span-4 space-y-8">

            <section className="bento-card">
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-violet-100 text-violet-600 p-2 rounded-2xl">
                  <Settings size={20} />
                </div>
                <h2 className="text-lg font-bold">模型摘要</h2>
              </div>
              <div className="space-y-4 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">目标值</span><span className="font-mono font-bold text-slate-700">{result.objectiveValue.toFixed(6)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">方案层区分度 dA</span><span className="font-mono font-bold text-slate-700">{result.dA.toFixed(6)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">近并列阈值 φ tie</span><span className="font-mono font-bold text-slate-700">{result.config.phiTie}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">分层阈值 φ sep</span><span className="font-mono font-bold text-slate-700">{result.config.phiSep}</span></div>
              </div>
            </section>


            <section className="bento-card">
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-blue-100 text-blue-600 p-2 rounded-2xl">
                  <Users size={20} />
                </div>
                <h2 className="text-lg font-bold">专家权重分布</h2>
              </div>
              <div className="space-y-6">
                {experts.map(e => (
                  <div key={e.id} className="space-y-2">
                    <div className="flex justify-between items-end">
                      <span className="text-sm font-bold text-slate-600">{e.name}</span>
                      <span className="text-xs font-mono font-bold text-blue-600">{(result.expertWeights[e.id] * 100).toFixed(2)}%</span>
                    </div>
                    <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden p-0.5">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${result.expertWeights[e.id] * 100}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        className="bg-blue-500 h-full rounded-full shadow-sm"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="bento-card">
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-emerald-100 text-emerald-600 p-2 rounded-2xl">
                  <Layers size={20} />
                </div>
                <h2 className="text-lg font-bold">属性权重分布</h2>
              </div>
              <div className="space-y-6">
                {attributes.map(a => (
                  <div key={a.id} className="space-y-2">
                    <div className="flex justify-between items-end">
                      <span className="text-sm font-bold text-slate-600">{a.name}</span>
                      <span className="text-xs font-mono font-bold text-emerald-600">{(result.attributeWeights[a.id] * 100).toFixed(2)}%</span>
                    </div>
                    <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden p-0.5">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${result.attributeWeights[a.id] * 100}%` }}
                        transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
                        className="bg-emerald-500 h-full rounded-full shadow-sm"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="bento-card">
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-amber-100 text-amber-600 p-2 rounded-2xl">
                  <Target size={20} />
                </div>
                <h2 className="text-lg font-bold">详细权重矩阵 (w_ijk)</h2>
              </div>
              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                显示各专家在不同属性下对各方案分配的具体权重值。
              </p>
              <div className="space-y-6">
                {alternatives.map(alt => (
                  <div key={alt.id} className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
                      <h3 className="text-sm font-bold text-slate-700">{alt.name}</h3>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-100">
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="bg-slate-50 text-slate-400 uppercase font-black tracking-tighter">
                            <th className="py-2 px-3 text-left border-b border-slate-100">专家 \ 属性</th>
                            {attributes.map(a => (
                              <th key={a.id} className="py-2 px-3 text-center border-b border-slate-100">{a.name}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {experts.map(e => (
                            <tr key={e.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="py-2 px-3 font-bold text-slate-500 border-b border-slate-50">{e.name}</td>
                              {attributes.map(a => (
                                <td key={a.id} className="py-2 px-3 text-center font-mono text-slate-600 border-b border-slate-50">
                                  {result.localWeights[e.id]?.[a.id]?.[alt.id]?.toFixed(4) || '0.0000'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="bg-slate-900 text-white p-8 rounded-[2.5rem] relative overflow-hidden group">
              <div className="absolute -right-10 -bottom-10 bg-white/5 w-40 h-40 rounded-full group-hover:scale-150 transition-transform duration-700"></div>
              <h3 className="text-xl font-bold mb-2">需要更多分析？</h3>
              <p className="text-slate-400 text-sm mb-6 leading-relaxed">您可以返回上一步修改偏好信息，或者重新定义模型参数。</p>
              <button 
                onClick={() => setStep(1)}
                className="w-full bg-white text-slate-900 py-3 rounded-2xl font-bold hover:bg-blue-50 transition-all"
              >
                重新开始分析
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc] font-sans text-slate-900 selection:bg-blue-100 selection:text-blue-900">
      <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-slate-900 p-2.5 rounded-[1rem] text-white shadow-lg shadow-slate-200">
              <Calculator size={24} />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-xl font-black tracking-tight text-slate-900">FAM <span className="text-blue-600">ENGINE</span></h1>
              <p className="text-[9px] text-slate-400 uppercase tracking-[0.2em] font-black">Adaptive Decision Intelligence</p>
            </div>
          </div>
          
          <nav className="hidden lg:flex items-center gap-1 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
            {[1, 2, 3].map((s) => (
              <button 
                key={s}
                onClick={() => s < step && setStep(s)}
                className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${step === s ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Step 0{s}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowHistory(true)}
              className="p-2.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all relative"
            >
              <History size={20} />
              {history.length > 0 && <span className="absolute top-2 right-2 w-2 h-2 bg-blue-500 rounded-full border-2 border-white"></span>}
            </button>
            <button 
              onClick={() => setShowHelp(true)}
              className="p-2.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all"
            >
              <HelpCircle size={20} />
            </button>
            <div className="h-6 w-[1px] bg-slate-200 mx-2"></div>
            <button className="p-2.5 bg-slate-900 text-white rounded-xl shadow-lg shadow-slate-200 hover:bg-blue-600 transition-all">
              <Settings size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-12 flex-grow w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="w-full bg-white border-t border-slate-200 mt-4 py-3">
        <div className="max-w-7xl mx-auto px-6">
          <div className="relative overflow-hidden">
            <button 
              onClick={() => setShowFooterInfo(!showFooterInfo)}
              className="flex items-center justify-between w-full text-left outline-none group/btn"
            >
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-3">
                <div className="bg-blue-50 p-1.5 rounded-lg text-blue-500 group-hover/btn:scale-110 transition-transform">
                  <Info size={18} />
                </div>
                关于网站
              </h3>
              <div className="flex items-center gap-4">
                <span className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] hidden sm:block">FAM Adaptive Decision Intelligence</span>
                <motion.div
                  animate={{ rotate: showFooterInfo ? 180 : 0 }}
                  transition={{ duration: 0.3 }}
                  className="text-slate-300 group-hover/btn:text-blue-500 transition-colors"
                >
                  <ChevronDown size={20} />
                </motion.div>
              </div>
            </button>
            <AnimatePresence>
              {showFooterInfo && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <p className="text-xs text-slate-500 leading-relaxed mt-2 pt-2 border-t border-slate-100">
                    本文提出一种专家信息自适应融合多属性决策方法（Fusion-based Adaptive Multi-attribute Decision-making, FAM），旨在将专家提供的排序信息与相对重要性信息统一转化为可计算的权重结构，并在保证方案排序区分度的同时增强专家层和属性层权重的辨识能力。
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-50 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-[10px] text-slate-400 font-medium">© 2026 FAM Engine. All rights reserved.</p>
            <div className="flex items-center gap-6">
              <button className="text-[10px] text-slate-400 hover:text-blue-600 font-bold uppercase tracking-wider transition-colors">隐私政策</button>
              <button className="text-[10px] text-slate-400 hover:text-blue-600 font-bold uppercase tracking-wider transition-colors">使用条款</button>
              <button className="text-[10px] text-slate-400 hover:text-blue-600 font-bold uppercase tracking-wider transition-colors">联系我们</button>
            </div>
          </div>
        </div>
      </footer>

      {/* History Sidebar */}
      <AnimatePresence>
        {showHistory && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-[70] shadow-2xl p-8 flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-100 text-blue-600 p-2 rounded-xl">
                    <History size={20} />
                  </div>
                  <h2 className="text-xl font-bold">分析历史</h2>
                </div>
                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-all">
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                {history.length === 0 ? (
                  <div className="text-center py-20">
                    <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                      <History size={24} className="text-slate-300" />
                    </div>
                    <p className="text-slate-400 text-sm">暂无历史记录</p>
                  </div>
                ) : (
                  history.map((item) => (
                    <button 
                      key={item.id}
                      onClick={() => loadHistoryItem(item)}
                      className="w-full text-left p-5 rounded-[1.5rem] border border-slate-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all group"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-bold text-slate-800 group-hover:text-blue-600 transition-colors">{item.name}</h3>
                        <span className="text-[10px] font-mono text-slate-400">{new Date(item.timestamp).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex -space-x-2">
                          {item.data.experts.slice(0, 3).map((e, i) => (
                            <div key={i} className="w-6 h-6 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center text-[8px] font-bold">
                              {e.name[0]}
                            </div>
                          ))}
                        </div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                          {item.data.experts.length} 专家 · {item.data.attributes.length} 属性
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Help Sidebar */}
      <AnimatePresence>
        {showHelp && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHelp(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-[70] shadow-2xl p-8 flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="bg-emerald-100 text-emerald-600 p-2 rounded-xl">
                    <BookOpen size={20} />
                  </div>
                  <h2 className="text-xl font-bold">方法论说明</h2>
                </div>
                <button onClick={() => setShowHelp(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-all">
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-8 pr-2 custom-scrollbar">
                <section>
                  <h3 className="font-bold text-slate-900 mb-2">什么是 FAM 模型？</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">
                    FAM (Fusion-based Adaptive MADM) 是一种面向多专家、多属性决策的优化模型。当前版本将专家权重作为已知输入，在不完整排序与比值信息基础上，同时求解属性权重、方案综合权重以及允许近并列的层级排序结果。
                  </p>
                </section>

                <section>
                  <h3 className="font-bold text-slate-900 mb-2">核心优势</h3>
                  <ul className="space-y-3">
                    {[
                      { title: "固定专家权重", desc: "专家权重 e_i 作为外生输入，并在局部权重单元上保持一致。" },
                      { title: "近并列同层", desc: "当相邻方案差异不超过 φ tie 时，可归入同一层级；当差异达到 φ sep 时，模型才强制分层。" },
                      { title: "多维融合", desc: "支持排序信息、比值信息与缺失输入的联合建模。" }
                    ].map((item, i) => (
                      <li key={i} className="flex gap-3">
                        <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                        <div>
                          <p className="text-sm font-bold text-slate-800">{item.title}</p>
                          <p className="text-xs text-slate-500">{item.desc}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100">
                  <h3 className="font-bold text-slate-900 mb-2 text-sm">计算逻辑</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    系统将输入的排序与比值信息转化为混合整数线性约束，并通过统一目标函数同时提升方案层区分度、专家内部指标区分度以及层级划分清晰性。
                  </p>
                  <div className="mt-4 font-mono text-[10px] bg-white p-3 rounded-xl border border-slate-100 text-slate-400">
                    max α·dA + β·Σ dC_i + η·Σ y_r
                  </div>
                </section>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
