# README.md

## 2026 Japanese Election – Candidate Data Collection (Yomiuri)

```markdown

This project is a Jupyter Notebook designed to **collect, process, and analyze candidate information** related to the 2026 Japanese election using publicly available data sources (e.g., Yomiuri Shimbun candidate pages).

The main goal of this notebook is to:
- Automatically gather candidate detail page URLs  
- Extract structured information about candidates  
- Prepare the dataset for further political or media analysis  

```

---

## Requirements

This notebook is designed to run in **Google Colab** or a standard Jupyter environment.

### Python Version
- Python 3.8+

### Required Libraries

```bash
pip install requests beautifulsoup4 pandas tqdm lxml
````

If using Google Colab, most dependencies are already installed.

---

## Google Drive Integration (Colab)

The notebook mounts Google Drive in order to:

* Read input files
* Save scraped or processed data

```python
from google.colab import drive
drive.mount('/content/drive')
```

Make sure your Drive structure matches the expected paths in the notebook.

---

## How to Use

### Step 1: Open the Notebook

Open `2026_Election_Yomiuri.ipynb` in:

* Google Colab **(recommended)**
  or
* Local Jupyter Notebook

---

### Step 2: Install Dependencies (if needed)

```python
!pip install requests beautifulsoup4 pandas tqdm lxml
```

---

### Step 3: Run Cells in Order

The notebook performs the following operations:

1. **Collect Candidate List URLs**

   * Accesses index pages containing candidate links
   * Extracts URLs for each candidate profile

2. **Fetch Candidate Detail Pages**

   * Sends HTTP requests
   * Handles encoding and HTML parsing

3. **Parse Candidate Information**
   Typical fields include:

   * Name
   * Party
   * Electoral district
   * Age
   * Career / background
   * Policy statements (if available)

4. **Store Results**

   * Data is saved into a Pandas DataFrame
   * Can be exported as CSV

Example:

```python
df.to_csv("candidates_2026.csv", index=False)
```

---

## Output Format

The final dataset is structured as a table:

| Name | Party | District | Age | Career | Source URL |
| ---- | ----- | -------- | --- | ------ | ---------- |

This format allows:

* Statistical analysis
* Visualization
* Machine learning preprocessing
* NLP on candidate statements

---

## Legal & Ethical Notes

* This notebook only accesses **publicly available web pages**
* Scraping is performed at a moderate rate to avoid server overload
* Always check the website’s robots.txt and terms of service
* Data is for **research and educational purposes only**

---

## Customization

You can easily modify:

* Target URLs
* Fields to extract
* Output file format

For example, to add a new field:

```python
candidate_data["twitter"] = twitter_url
```

---

## Troubleshooting

### Encoding Errors

Try:

```python
response.encoding = response.apparent_encoding
```

### Missing Data

* Some candidates do not publish all fields
* Always handle `None` or empty strings

### Connection Errors

* Use retries
* Add sleep between requests

---

## License

This project is released for **academic and non-commercial research use**.
If you reuse the code, please cite the data source.

---

## Author

Created by: *ryouy*
Project: 2026 Japanese Election Candidate Data Collection
