import { Mail, ShieldCheck } from 'lucide-react';

const brandMarkUrl = `${import.meta.env.BASE_URL}zhiluo-icons/zhiluo-mark-ai-v1.png`;

const footerLinks = [
  { label: '工作区', href: '#workspace' },
  { label: '关于纸落', href: '#about' },
  { label: '隐私说明', href: '#privacy' },
  { label: '联系作者', href: 'mailto:lhl20040919@gmail.com' },
];

export function Footer() {
  return (
    <footer className="site-footer" id="privacy">
      <div className="site-footer-inner">
        <a className="footer-brand" href="#about" aria-label="回到纸落介绍">
          <img className="footer-brand-mark" src={brandMarkUrl} alt="" aria-hidden="true" />
          <span className="footer-brand-copy">
            <strong>纸落</strong>
            <small>ZHILUO · LOCAL FILE TOOLS</small>
          </span>
        </a>

        <p className="footer-description">
          轻量的浏览器端文件工具，让常用的 PDF 与图片处理更简单、更安心。
        </p>

        <nav className="footer-nav" aria-label="页脚导航">
          {footerLinks.map((link) => (
            <a key={link.label} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="footer-contact" aria-label="作者信息">
          <span className="footer-contact-item">
            <span className="footer-contact-label">作者</span>
            <strong>多吉扎西</strong>
          </span>
          <a className="footer-contact-item footer-email" href="mailto:lhl20040919@gmail.com">
            <Mail size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>lhl20040919@gmail.com</span>
          </a>
        </div>
      </div>

      <div className="footer-divider" aria-hidden="true" />

      <div className="footer-bottom">
        <p>© {new Date().getFullYear()} 纸落 · ZhiLuo. 保留所有权利。</p>
        <p className="footer-local-note">
          <ShieldCheck size={13} strokeWidth={1.8} aria-hidden="true" />
          文件仅在浏览器本地处理 · 不上传服务器 · 单个文件最大 500 MB
        </p>
      </div>
    </footer>
  );
}
