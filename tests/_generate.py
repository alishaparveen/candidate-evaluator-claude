"""
Generator for the Plum Builders test pack.
Creates all resume PDFs and .eml fixtures.
Run once: python _generate.py
"""
import os
import io
from email.message import EmailMessage
from email.utils import make_msgid, formatdate
from datetime import datetime, timedelta
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch

ROOT = os.path.dirname(os.path.abspath(__file__))
ATT = os.path.join(ROOT, "attachments")
FIX = os.path.join(ROOT, "fixtures")

styles = getSampleStyleSheet()
H = ParagraphStyle('H', parent=styles['Heading1'], fontSize=16, spaceAfter=8)
H2 = ParagraphStyle('H2', parent=styles['Heading2'], fontSize=12, spaceAfter=4, spaceBefore=10)
N = ParagraphStyle('N', parent=styles['Normal'], fontSize=10, spaceAfter=4)


def make_resume_pdf(filename, name, content_blocks):
    """content_blocks: list of (heading, [bullet strings])"""
    path = os.path.join(ATT, filename)
    doc = SimpleDocTemplate(path, pagesize=letter,
                            leftMargin=0.7*inch, rightMargin=0.7*inch,
                            topMargin=0.7*inch, bottomMargin=0.7*inch)
    story = [Paragraph(name, H)]
    for heading, bullets in content_blocks:
        story.append(Paragraph(heading, H2))
        for b in bullets:
            story.append(Paragraph(f"• {b}", N))
        story.append(Spacer(1, 4))
    doc.build(story)
    return path


def make_scanned_pdf(filename):
    """Create a PDF that is just a rasterized image — no extractable text."""
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter
    from PIL import Image, ImageDraw, ImageFont
    # Create an image of "text"
    img = Image.new('RGB', (1700, 2200), 'white')
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 36)
        sfont = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 24)
    except Exception:
        font = ImageFont.load_default()
        sfont = font
    lines = [
        "ANITA RAMAKRISHNAN", "",
        "EXPERIENCE", "",
        "Senior Engineer, Acme Corp (2020-2024)",
        "  - Led migration to microservices",
        "  - Shipped payment platform serving 2M users",
        "",
        "Engineer, Beta Inc (2018-2020)",
        "  - Built internal analytics dashboards",
        "",
        "EDUCATION",
        "BTech Computer Science, IIT Madras, 2018",
        "",
        "SKILLS",
        "Python, Go, Postgres, AWS, Kubernetes",
    ]
    y = 100
    for line in lines:
        d.text((100, y), line, fill='black', font=font if line and not line.startswith(' ') else sfont)
        y += 50
    img_path = os.path.join(ATT, filename.replace('.pdf', '.png'))
    img.save(img_path)
    # Embed image in PDF (no text layer)
    pdf_path = os.path.join(ATT, filename)
    c = canvas.Canvas(pdf_path, pagesize=letter)
    c.drawImage(img_path, 0.5*inch, 0.5*inch, width=7.5*inch, height=10*inch)
    c.save()
    os.remove(img_path)
    return pdf_path


def make_corrupt_docx(filename):
    """A .docx file (just a renamed text file — agent should reject non-PDF)."""
    path = os.path.join(ATT, filename)
    with open(path, 'wb') as f:
        # Minimal ZIP-like garbage so it's clearly not a PDF
        f.write(b'PK\x03\x04' + b'fake docx content - not a real word document' * 20)
    return path


# ============================================================
# RESUMES
# ============================================================

def build_pdfs():
    # ---- STRONG ----
    make_resume_pdf("strong_01_priya.pdf", "Priya Menon — Senior Full-Stack Engineer", [
        ("Contact", ["priya.menon.dev@gmail.com | github.com/priyamenon-dev | priyamenon.io"]),
        ("Experience", [
            "Staff Engineer, Razorpay (2022–2025): Led the rollout of UPI Lite, scaled to 8M monthly active users, owned the merchant onboarding API rewrite that cut p99 latency from 1.2s to 180ms.",
            "Senior Engineer, Swiggy (2019–2022): Built the dynamic pricing service for Instamart, shipped to production in 11 weeks, drove a 3.4% margin improvement on grocery orders.",
            "Founding Engineer, Klub.app (2017–2019, acquired): Wrote the original revenue-based-financing underwriting engine. Acquired by GetVantage in 2019.",
        ]),
        ("Selected Projects", [
            "littlebird (github.com/priyamenon-dev/littlebird) — open-source Postgres CDC tool, 4.2k stars, used by ~30 companies in production per the contributor list.",
            "tinyhost — self-hosted PaaS for hobby projects. ~600 weekly active users on the hosted version.",
        ]),
        ("Skills", ["Go, Python, TypeScript, Postgres, Kafka, Kubernetes, Terraform"]),
        ("Education", ["BTech Computer Science, IIT Bombay, 2017"]),
    ])

    make_resume_pdf("strong_02_arjun.pdf", "Arjun Krishnan — Product Engineer", [
        ("Contact", ["arjun.k.builds@gmail.com | github.com/arjunkbuilds | arjunk.dev"]),
        ("Experience", [
            "Product Engineer, Linear (2023–2025): Owned the Linear Asks integration, designed the routing rules engine from scratch, shipped to GA in 4 months. Wrote 60% of the frontend and the entire backend.",
            "SDE-2, Atlassian (2021–2023): Worked on Jira automation. Reduced rule evaluation time by 70% via a graph-based scheduler I proposed and built.",
        ]),
        ("Selected Projects", [
            "askterm.dev — natural-language CLI assistant. 2.1k GitHub stars, ~150 paying users at $4/mo. Built solo over 4 weekends.",
        ]),
        ("Skills", ["TypeScript, Rust, React, tRPC, Postgres, Redis"]),
        ("Education", ["BE Computer Science, BITS Pilani, 2021"]),
    ])

    make_resume_pdf("strong_03_devika.pdf", "Devika Shah — Full-Stack Developer (self-taught)", [
        ("Contact", ["devika.builds@protonmail.com | github.com/devikabuilds | devika.cafe"]),
        ("Background", ["Self-taught (no CS degree). Bootcamp grad (Lambda School, 2020). Three years of contract work, currently full-time on my own products."]),
        ("Shipped Products", [
            "ledgerlite.app — bookkeeping for Indian freelancers. 800 paying users at ₹299/mo. Built and run solo since 2022. Featured on YourStory.",
            "kiranabot.in — WhatsApp ordering bot for neighborhood stores. 12 stores live in Bangalore, ₹4L GMV/month routed through it.",
        ]),
        ("Open Source", [
            "razorpay-py-async (github.com/devikabuilds/razorpay-py-async) — async Python wrapper, 380 stars, downloaded ~12k times/month on PyPI.",
        ]),
        ("Skills", ["Python, FastAPI, Next.js, Postgres, Redis, AWS"]),
    ])

    make_resume_pdf("strong_04_rahul.pdf", "Rahul Iyer — Junior Developer", [
        ("Contact", ["rahul.iyer.2024@gmail.com | github.com/rahuliyer-2024 | rahuliyer.xyz"]),
        ("Education", ["BE Computer Science, VIT Vellore, 2024 (CGPA 8.9)"]),
        ("Experience", [
            "SWE Intern, Atlan (Jun–Aug 2024): Built the data lineage diff viewer; merged 14 PRs to the production codebase. Got a return offer.",
        ]),
        ("Standout Project", [
            "studybuddy.live — collaborative Pomodoro + flashcard app for college students. 4,200 weekly active users across 38 Indian colleges. Built solo. Featured on Product Hunt (#3 product of the day).",
            "All revenue (~₹35k/mo from Pro tier) goes back into hosting; treating it as a learning vehicle, not a business.",
        ]),
        ("Skills", ["TypeScript, React, Node.js, Postgres, WebSockets"]),
    ])

    # ---- WEAK ----
    make_resume_pdf("weak_01_vikram.pdf", "Vikram Sharma — Full Stack Developer", [
        ("Summary", ["Passionate full-stack developer with experience leveraging cutting-edge technologies to deliver scalable enterprise solutions in agile environments."]),
        ("Experience", [
            "Software Engineer, Tech Solutions Pvt Ltd (2021–2024): Worked on multiple projects using various technologies. Collaborated with cross-functional teams. Followed agile methodologies.",
            "Junior Developer, Innovate Systems (2019–2021): Developed and maintained applications. Participated in code reviews. Delivered features on time.",
        ]),
        ("Skills", ["JavaScript, Python, Java, C++, C#, PHP, Ruby, Go, Rust, Swift, Kotlin, HTML, CSS, React, Angular, Vue, Node.js, Django, Flask, Spring, .NET, MySQL, MongoDB, PostgreSQL, Redis, AWS, Azure, GCP, Docker, Kubernetes, Jenkins, Git"]),
        ("Education", ["BTech IT, Generic Engineering College, 2019"]),
    ])

    make_resume_pdf("weak_02_sneha.pdf", "Sneha Patel — MERN Stack Developer", [
        ("Experience", [
            "Software Developer Trainee, MindTree Learning (2023–present): Completed training in MERN stack. Built training projects.",
        ]),
        ("Projects", [
            "E-commerce website (clone) — Built a full-stack e-commerce site as part of training.",
            "Todo app — React + Node.js todo application with login.",
            "Weather app — React app that consumes a public weather API.",
        ]),
        ("Skills", ["MongoDB, Express, React, Node.js, JavaScript, HTML, CSS"]),
        ("Education", ["BCA, Open University, 2023"]),
    ])

    make_resume_pdf("weak_03_amit.pdf", "Amit Verma — Senior Software Architect", [
        ("Summary", ["Results-driven senior software architect with 10+ years of experience driving digital transformation initiatives, optimizing operational efficiency by 47%, and leveraging AI/ML to deliver business value across the enterprise software landscape."]),
        ("Experience", [
            "Senior Software Architect, Confidential Fortune 500 (2020–present): Architected scalable microservices-based solutions. Increased team velocity by 35%. Reduced cloud costs by 28%. Improved customer satisfaction by 42%.",
            "Lead Engineer, Fortune 100 Bank (2017–2020): Led migration to cloud-native architecture. Saved $2.3M annually. Mentored 25+ engineers.",
        ]),
        ("Achievements", ["Increased velocity by 35%. Reduced costs by 28%. Improved CSAT by 42%. Saved $2.3M. Mentored 25+ engineers. Filed 3 patents (pending)."]),
        ("Skills", ["Microservices, Cloud Architecture, AI/ML, Digital Transformation, Agile, DevOps, Leadership, Stakeholder Management"]),
    ])

    make_resume_pdf("weak_04_neha.pdf", "Neha Gupta — Frontend Developer", [
        ("Experience", [
            "Frontend Developer (Freelance, 2022–present): Designed websites for small businesses. See portfolio.",
        ]),
        ("Portfolio", ["Portfolio link in email — screenshots of designs."]),
        ("Skills", ["HTML, CSS, JavaScript, Figma, WordPress"]),
        ("Education", ["BCom, Delhi University, 2022"]),
    ])

    # ---- BORDERLINE ----
    make_resume_pdf("borderline_01_karan.pdf", "Karan Malhotra — Engineering Manager → IC", [
        ("Experience", [
            "Engineering Manager, Flipkart (2020–2024): Led a team of 8 building the seller payments platform. Drove 0→1 of the auto-disbursement product.",
            "Senior Engineer, Myntra (2017–2020): Built the recommendation pipeline; A/B testing showed +6.2% conversion.",
        ]),
        ("Note", ["Stepped back from management in 2024 to return to hands-on building. GitHub activity is sparse — most code I write is on internal repos."]),
        ("Skills", ["Java, Scala, Spark, Kafka, Postgres"]),
        ("Education", ["BTech, NIT Trichy, 2015"]),
    ])

    make_resume_pdf("borderline_02_aisha.pdf", "Aisha Khan — Backend Engineer", [
        ("Experience", [
            "Backend Engineer, Postman (2022–2025): Built parts of the Postman Flows runtime.",
        ]),
        ("Open Source / GitHub", [
            "active contributor to open-source Postgres tooling — see github.com/aishakdev",
            "shipped pgmate (520 stars), pg-shadow (180 stars), several smaller libraries",
        ]),
        ("Skills", ["Go, Rust, Postgres, distributed systems"]),
        ("Education", ["BE, MS Ramaiah Institute, 2022"]),
    ])

    make_resume_pdf("borderline_03_rohan.pdf", "Rohan Desai — Independent Contractor", [
        ("Background", ["Independent contractor since 2021. All client work under NDA — GitHub profile shows mostly private repos and a handful of small public ones."]),
        ("Selected Engagements (anonymized)", [
            "Series-B fintech: Rebuilt the KYC ingestion pipeline. Reduced manual review queue by 60%. (6-month engagement)",
            "Logistics startup (YC W22): Migrated monolith to event-driven architecture in 4 months.",
            "Health-tech scale-up: Designed and shipped the appointment scheduling service from scratch.",
        ]),
        ("References available on request.", []),
        ("Skills", ["Python, Go, Postgres, Kafka, Terraform, AWS"]),
    ])

    # ---- EDGE ----
    make_resume_pdf("edge_multi_a.pdf", "Sample Resume A", [
        ("Note", ["This is one of two PDFs attached — agent must figure out which is the resume."]),
    ])
    make_resume_pdf("edge_multi_b_coverletter.pdf", "Cover Letter", [
        ("Cover Letter", ["Dear Hiring Team, I am excited to apply..."]),
    ])
    make_resume_pdf("edge_no_github.pdf", "Tanvi Joshi", [
        ("Experience", ["Engineer at a small startup. Shipped a B2B dashboard."]),
        ("Skills", ["Python, React"]),
    ])
    make_resume_pdf("edge_broken_portfolio.pdf", "Karthik Rao", [
        ("Experience", ["Backend engineer. 3 years of experience."]),
        ("Skills", ["Go, Postgres"]),
    ])
    make_resume_pdf("edge_404_github.pdf", "Sanjay Iyer", [
        ("Experience", ["Frontend engineer. 4 years."]),
        ("Skills", ["React, TypeScript"]),
    ])
    make_corrupt_docx("edge_resume.docx")
    make_scanned_pdf("edge_scanned_resume.pdf")
    print("PDFs built.")


# ============================================================
# EML FIXTURES
# ============================================================

BASE_DATE = datetime(2025, 11, 5, 10, 0, 0)


def make_eml(out_path, *, frm, subject, body, to="apply@yourdomain.com",
             attachments=None, headers=None, html_body=None, date_offset_min=0,
             message_id=None, in_reply_to=None, references=None):
    msg = EmailMessage()
    msg['From'] = frm
    msg['To'] = to
    msg['Subject'] = subject
    msg['Date'] = formatdate((BASE_DATE + timedelta(minutes=date_offset_min)).timestamp(), localtime=False)
    msg['Message-ID'] = message_id or make_msgid(domain='mail.example.com')
    if in_reply_to:
        msg['In-Reply-To'] = in_reply_to
        msg['References'] = references or in_reply_to
    if headers:
        for k, v in headers.items():
            msg[k] = v
    msg.set_content(body)
    if html_body:
        msg.add_alternative(html_body, subtype='html')
    if attachments:
        for att_path in attachments:
            fname = os.path.basename(att_path)
            ext = fname.lower().rsplit('.', 1)[-1]
            if ext == 'pdf':
                maintype, subtype = 'application', 'pdf'
            elif ext == 'docx':
                maintype, subtype = 'application', 'vnd.openxmlformats-officedocument.wordprocessingml.document'
            else:
                maintype, subtype = 'application', 'octet-stream'
            with open(att_path, 'rb') as f:
                msg.add_attachment(f.read(), maintype=maintype, subtype=subtype, filename=fname)
    with open(out_path, 'wb') as f:
        f.write(bytes(msg))


def build_eml():
    # ---------- STRONG ----------
    d = os.path.join(FIX, '01_strong')

    make_eml(os.path.join(d, 'strong_01_senior_fullstack.eml'),
             frm='Priya Menon <priya.menon.dev@gmail.com>',
             subject='Application — Founder\'s Office role',
             body=(
                 "Hi Plum team,\n\n"
                 "I came across the Builder's Residency post and would love to be considered.\n\n"
                 "I'm Priya — most recently Staff Engineer at Razorpay, where I led the UPI Lite "
                 "rollout. Resume attached.\n\n"
                 "GitHub: https://github.com/priyamenon-dev\n"
                 "Portfolio: https://priyamenon.io\n\n"
                 "Happy to chat.\n\n— Priya"
             ),
             attachments=[os.path.join(ATT, 'strong_01_priya.pdf')],
             date_offset_min=0)

    make_eml(os.path.join(d, 'strong_02_mid_strong_project.eml'),
             frm='Arjun Krishnan <arjun.k.builds@gmail.com>',
             subject='Builder Residency application',
             body=(
                 "Hey,\n\n"
                 "Throwing my hat in. Currently a product engineer at Linear, side-shipping askterm.dev.\n\n"
                 "Resume: attached\n"
                 "GitHub: github.com/arjunkbuilds\n"
                 "Portfolio: https://arjunk.dev\n\n"
                 "Cheers,\nArjun"
             ),
             attachments=[os.path.join(ATT, 'strong_02_arjun.pdf')],
             date_offset_min=15)

    make_eml(os.path.join(d, 'strong_03_nontraditional.eml'),
             frm='Devika Shah <devika.builds@protonmail.com>',
             subject='Application — self-taught builder',
             body=(
                 "Hi,\n\n"
                 "No CS degree, but I run two products full-time (ledgerlite.app, "
                 "kiranabot.in) and maintain razorpay-py-async. Would love to be considered.\n\n"
                 "Resume attached.\n"
                 "GitHub: https://github.com/devikabuilds\n"
                 "Portfolio: https://devika.cafe\n\n"
                 "Best,\nDevika"
             ),
             attachments=[os.path.join(ATT, 'strong_03_devika.pdf')],
             date_offset_min=30)

    make_eml(os.path.join(d, 'strong_04_junior_exceptional.eml'),
             frm='Rahul Iyer <rahul.iyer.2024@gmail.com>',
             subject='Application: Plum Builder Residency',
             body=(
                 "Hi Plum team,\n\n"
                 "I graduated from VIT Vellore in 2024 and have been running studybuddy.live "
                 "(4.2k WAU, 38 colleges) since my third year. Got a return offer from Atlan but "
                 "want to build something of my own — the Residency feels like the right next step.\n\n"
                 "Resume attached.\n"
                 "GitHub: https://github.com/rahuliyer-2024\n"
                 "Portfolio (studybuddy.live): https://rahuliyer.xyz\n\n"
                 "Thanks for considering!\nRahul"
             ),
             attachments=[os.path.join(ATT, 'strong_04_rahul.pdf')],
             date_offset_min=45)

    # ---------- WEAK ----------
    d = os.path.join(FIX, '02_weak')

    make_eml(os.path.join(d, 'weak_01_buzzwords_no_ship.eml'),
             frm='Vikram Sharma <vikram.sharma.dev@gmail.com>',
             subject='Job Application',
             body=(
                 "Respected Sir/Madam,\n\n"
                 "I am writing to apply for the role at your esteemed organization. I have "
                 "3+ years of experience in full-stack development with proven track record "
                 "of delivering scalable solutions in agile environments.\n\n"
                 "Please find my resume attached.\n\n"
                 "GitHub: https://github.com/vikram-sharma-dev\n"
                 "Portfolio: https://vikramsharma.netlify.app\n\n"
                 "Thanks & Regards,\nVikram Sharma"
             ),
             attachments=[os.path.join(ATT, 'weak_01_vikram.pdf')],
             date_offset_min=60)

    make_eml(os.path.join(d, 'weak_02_forks_only.eml'),
             frm='Sneha Patel <sneha.patel.mern@gmail.com>',
             subject='Applying for the role',
             body=(
                 "Hi,\n\nI'm a MERN stack developer and would like to apply.\n\n"
                 "Resume attached.\n"
                 "GitHub: https://github.com/sneha-mern (mostly tutorial forks, learning in public)\n"
                 "Portfolio: https://sneha-portfolio.vercel.app\n\nThanks,\nSneha"
             ),
             attachments=[os.path.join(ATT, 'weak_02_sneha.pdf')],
             date_offset_min=75)

    make_eml(os.path.join(d, 'weak_03_ai_generated_tells.eml'),
             frm='Amit Verma <amit.verma.architect@gmail.com>',
             subject='Senior Software Architect — Application',
             body=(
                 "Dear Hiring Manager,\n\n"
                 "I am thrilled to express my keen interest in the Builder's Residency. With "
                 "10+ years of experience driving digital transformation, I have consistently "
                 "delivered impactful results, including a 47% improvement in operational "
                 "efficiency and $2.3M in annual savings.\n\n"
                 "I am passionate about leveraging cutting-edge technologies to drive business "
                 "value and would love to contribute my expertise to your innovative team.\n\n"
                 "Please find my resume attached for your perusal.\n\n"
                 "GitHub: https://github.com/amitverma-architect (most work is on internal enterprise repos)\n"
                 "Portfolio: https://amitverma.medium.com\n\n"
                 "Looking forward to your positive response.\n\nWarm regards,\nAmit Verma"
             ),
             attachments=[os.path.join(ATT, 'weak_03_amit.pdf')],
             date_offset_min=90)

    make_eml(os.path.join(d, 'weak_04_screenshot_portfolio.eml'),
             frm='Neha Gupta <neha.designs@gmail.com>',
             subject='Frontend Developer — Application',
             body=(
                 "Hi,\n\nApplying for the role. I'm a freelance frontend developer.\n\n"
                 "Resume: attached\n"
                 "GitHub: https://github.com/nehag-designs (just my freelance project files)\n"
                 "Portfolio: https://neha-designs.notion.site/portfolio (screenshots of work)\n\n"
                 "Best,\nNeha"
             ),
             attachments=[os.path.join(ATT, 'weak_04_neha.pdf')],
             date_offset_min=105)

    # ---------- BORDERLINE ----------
    d = os.path.join(FIX, '03_borderline')

    make_eml(os.path.join(d, 'borderline_01_resume_strong_github_dead.eml'),
             frm='Karan Malhotra <karan.m.eng@gmail.com>',
             subject='Application — returning IC',
             body=(
                 "Hi,\n\n"
                 "I'm Karan — most recently EM at Flipkart, before that senior IC at Myntra. "
                 "I'm transitioning back to hands-on building and would love to be considered.\n\n"
                 "Heads up: my GitHub is sparse because most of my code lives in internal repos. "
                 "Happy to walk through real work in a conversation.\n\n"
                 "Resume attached.\n"
                 "GitHub: https://github.com/karanm-eng\n"
                 "Portfolio: https://karanm.substack.com (engineering writing)\n\n"
                 "— Karan"
             ),
             attachments=[os.path.join(ATT, 'borderline_01_karan.pdf')],
             date_offset_min=120)

    make_eml(os.path.join(d, 'borderline_02_github_strong_no_portfolio.eml'),
             frm='Aisha Khan <aishak.dev@gmail.com>',
             subject='Builder Residency',
             body=(
                 "Hi,\n\n"
                 "Applying. Most of what I'd want you to look at is on GitHub — I don't have "
                 "a separate portfolio site.\n\n"
                 "Resume: attached\n"
                 "GitHub: https://github.com/aishakdev (pgmate, pg-shadow, etc.)\n\n"
                 "Aisha"
             ),
             attachments=[os.path.join(ATT, 'borderline_02_aisha.pdf')],
             date_offset_min=135)

    make_eml(os.path.join(d, 'borderline_03_private_repos_only.eml'),
             frm='Rohan Desai <rohan.builds@fastmail.com>',
             subject='Application — independent contractor',
             body=(
                 "Hi Plum team,\n\n"
                 "I've been an independent contractor since 2021. All client work is under NDA "
                 "so my public GitHub is thin — but I can show real production code in a call.\n\n"
                 "Resume: attached\n"
                 "GitHub: https://github.com/rohan-d (mostly small public repos)\n"
                 "Portfolio: https://rohandesai.work\n\n"
                 "Best,\nRohan"
             ),
             attachments=[os.path.join(ATT, 'borderline_03_rohan.pdf')],
             date_offset_min=150)

    # ---------- EDGE CASES ----------
    d = os.path.join(FIX, '04_edge_cases')

    make_eml(os.path.join(d, 'edge_01_no_attachment.eml'),
             frm='Maya Iyengar <maya.builds@gmail.com>',
             subject='Application',
             body=(
                 "Hi,\n\nI'd like to apply.\n\n"
                 "GitHub: https://github.com/maya-builds\n"
                 "Portfolio: https://mayabuilds.com\n\n"
                 "(Resume to follow.)\n\nMaya"
             ),
             date_offset_min=165)

    make_eml(os.path.join(d, 'edge_02_docx_not_pdf.eml'),
             frm='Karthik Pillai <karthik.p@gmail.com>',
             subject='Resume for Builder Residency',
             body=(
                 "Hey,\n\nSee attached resume.\n\n"
                 "GitHub: https://github.com/karthik-p\n"
                 "Portfolio: https://karthikpillai.dev\n\n— Karthik"
             ),
             attachments=[os.path.join(ATT, 'edge_resume.docx')],
             date_offset_min=180)

    make_eml(os.path.join(d, 'edge_03_scanned_pdf.eml'),
             frm='Anita Ramakrishnan <anita.r.eng@gmail.com>',
             subject='Senior Engineer — Application',
             body=(
                 "Dear Sir/Madam,\n\nPlease find my CV attached.\n\n"
                 "GitHub: https://github.com/anita-r-eng\n"
                 "Portfolio: https://anitar.dev\n\nRegards,\nAnita"
             ),
             attachments=[os.path.join(ATT, 'edge_scanned_resume.pdf')],
             date_offset_min=195)

    make_eml(os.path.join(d, 'edge_04_no_github.eml'),
             frm='Tanvi Joshi <tanvi.j.dev@gmail.com>',
             subject='Application',
             body=(
                 "Hi, applying for the role.\n\n"
                 "Resume attached.\nPortfolio: https://tanvi.dev\n\n(I don't have a public "
                 "GitHub — most of my work has been on private company repos.)\n\nTanvi"
             ),
             attachments=[os.path.join(ATT, 'edge_no_github.pdf')],
             date_offset_min=210)

    make_eml(os.path.join(d, 'edge_05_broken_portfolio.eml'),
             frm='Karthik Rao <karthik.r.dev@gmail.com>',
             subject='Builder Residency Application',
             body=(
                 "Hi,\n\nResume attached.\n\n"
                 "GitHub: https://github.com/karthikrao-dev\n"
                 "Portfolio: https://this-domain-definitely-does-not-exist-12345.com\n\n— Karthik"
             ),
             attachments=[os.path.join(ATT, 'edge_broken_portfolio.pdf')],
             date_offset_min=225)

    make_eml(os.path.join(d, 'edge_06_404_github.eml'),
             frm='Sanjay Iyer <sanjay.i.fe@gmail.com>',
             subject='Application',
             body=(
                 "Hi,\n\nApplying.\n\n"
                 "Resume attached.\n"
                 "GitHub: https://github.com/this-user-does-not-exist-987654321\n"
                 "Portfolio: https://sanjayiyer.dev\n\nThanks,\nSanjay"
             ),
             attachments=[os.path.join(ATT, 'edge_404_github.pdf')],
             date_offset_min=240)

    make_eml(os.path.join(d, 'edge_07_multiple_pdfs.eml'),
             frm='Aditi Bose <aditi.b@gmail.com>',
             subject='Application — resume + cover letter',
             body=(
                 "Hi,\n\nAttached: resume and cover letter.\n\n"
                 "GitHub: https://github.com/aditi-b\n"
                 "Portfolio: https://aditi.dev\n\nAditi"
             ),
             attachments=[os.path.join(ATT, 'edge_multi_a.pdf'),
                          os.path.join(ATT, 'edge_multi_b_coverletter.pdf')],
             date_offset_min=255)

    make_eml(os.path.join(d, 'edge_08_gibberish.eml'),
             frm='asdf <kjsdhf@kjsdhf.com>',
             subject='asdfghjkl',
             body='lkjasdflkjasdflkjasdflkjasdflkjasdf\n\nzxcvbnm qwertyuiop',
             date_offset_min=270)

    make_eml(os.path.join(d, 'edge_09_non_english.eml'),
             frm='Wei Zhang <wei.zhang.dev@gmail.com>',
             subject='申请 — Builder Residency',
             body=(
                 "您好，\n\n我想申请这个职位。简历附上。\n\n"
                 "GitHub: https://github.com/wei-z-dev\n"
                 "Portfolio: https://weizhang.dev\n\n谢谢，\n张伟"
             ),
             attachments=[os.path.join(ATT, 'edge_no_github.pdf')],  # reuse a PDF
             date_offset_min=285)

    make_eml(os.path.join(d, 'edge_10_empty_body.eml'),
             frm='Rishi Kapoor <rishi.k@gmail.com>',
             subject='',
             body='',
             attachments=[os.path.join(ATT, 'edge_no_github.pdf')],
             date_offset_min=300)

    # Duplicate (same Message-ID) — agent must dedupe by Message-ID
    dup_msgid = '<duplicate-test-001@mail.example.com>'
    make_eml(os.path.join(d, 'edge_11a_duplicate_first.eml'),
             frm='Priya Menon <priya.menon.dev@gmail.com>',
             subject='Application — Founder\'s Office role',
             body='Original send. Resume attached.\nGitHub: https://github.com/priyamenon-dev\nPortfolio: https://priyamenon.io',
             attachments=[os.path.join(ATT, 'strong_01_priya.pdf')],
             message_id=dup_msgid,
             date_offset_min=315)
    make_eml(os.path.join(d, 'edge_11b_duplicate_second.eml'),
             frm='Priya Menon <priya.menon.dev@gmail.com>',
             subject='Application — Founder\'s Office role',
             body='Original send. Resume attached.\nGitHub: https://github.com/priyamenon-dev\nPortfolio: https://priyamenon.io',
             attachments=[os.path.join(ATT, 'strong_01_priya.pdf')],
             message_id=dup_msgid,
             date_offset_min=316)

    # Reply to a needs-info request (agent's earlier ask)
    needs_info_msgid = '<needs-info-thread-001@yourdomain.com>'
    make_eml(os.path.join(d, 'edge_12_reply_to_needs_info.eml'),
             frm='Maya Iyengar <maya.builds@gmail.com>',
             subject='Re: We need a few more things to evaluate your application',
             body=(
                 "Hey, sorry — here's my resume.\n\n"
                 "(GitHub and portfolio were in my first email.)\n\nMaya"
             ),
             attachments=[os.path.join(ATT, 'strong_04_rahul.pdf')],  # reuse a real PDF
             in_reply_to=needs_info_msgid,
             references=needs_info_msgid,
             date_offset_min=330)

    # Marketing email — should be SKIPPED
    make_eml(os.path.join(d, 'edge_13_marketing_email.eml'),
             frm='Apollo <hello@apollo.io>',
             subject='Come back to Apollo. Your leads are still in there.',
             body=(
                 "Hi there,\n\nWe noticed you haven't logged in. Your leads are waiting!\n\n"
                 "Click here to log back in: https://apollo.io/login\n\n"
                 "Unsubscribe: https://apollo.io/unsubscribe?u=12345\n"
             ),
             html_body='<html><body><p>Marketing email with tracking pixel.</p><img src="https://track.apollo.io/px?u=12345" /></body></html>',
             headers={
                 'List-Unsubscribe': '<https://apollo.io/unsubscribe?u=12345>, <mailto:unsubscribe@apollo.io>',
                 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                 'Precedence': 'bulk',
                 'X-Mailer': 'SendGrid',
             },
             date_offset_min=345)

    # Recruiter outreach — should be SKIPPED (not an application)
    make_eml(os.path.join(d, 'edge_14_recruiter_outreach.eml'),
             frm='Ritika from TalentHub <ritika@talenthub-recruiting.com>',
             subject='Senior engineers available for hire — let\'s connect',
             body=(
                 "Hi,\n\nI'm Ritika from TalentHub. We have a pool of pre-vetted senior engineers "
                 "currently looking for opportunities. Would you be open to a quick call to discuss "
                 "how we can help with your hiring?\n\n"
                 "Best,\nRitika\nTalentHub Recruiting"
             ),
             date_offset_min=360)

    print("EML fixtures built.")


if __name__ == '__main__':
    build_pdfs()
    build_eml()
    print("\nDone. Check fixtures/ and attachments/.")
