
import { UserInput, LifeDestinyResult, Gender } from "../types";
import { BAZI_SYSTEM_INSTRUCTION } from "../constants";

// Helper to determine stem polarity
const getStemPolarity = (pillar: string): 'YANG' | 'YIN' => {
  if (!pillar) return 'YANG'; // default
  const firstChar = pillar.trim().charAt(0);
  const yangStems = ['甲', '丙', '戊', '庚', '壬'];
  const yinStems = ['乙', '丁', '己', '辛', '癸'];
  
  if (yangStems.includes(firstChar)) return 'YANG';
  if (yinStems.includes(firstChar)) return 'YIN';
  return 'YANG'; // fallback
};

export const generateLifeAnalysis = async (input: UserInput): Promise<LifeDestinyResult> => {
  
  const { apiKey, apiBaseUrl, modelName } = input;

  // FIX: Trim whitespace which causes header errors if copied with newlines
  const cleanApiKey = apiKey ? apiKey.trim() : "";
  const cleanBaseUrl = apiBaseUrl ? apiBaseUrl.trim().replace(/\/+$/, "") : "";
  const targetModel = modelName && modelName.trim() ? modelName.trim() : "deepseek-v4-flash";

  if (!cleanApiKey) {
    throw new Error("请在表单中填写有效的 API Key");
  }
  
  // Check for non-ASCII characters to prevent obscure 'Failed to construct Request' errors
  // If user accidentally pastes Chinese characters or emojis in the API key field
  if (/[^\x00-\x7F]/.test(cleanApiKey)) {
    throw new Error("API Key 包含非法字符（如中文或全角符号），请检查输入是否正确。");
  }

  if (!cleanBaseUrl) {
    throw new Error("请在表单中填写有效的 API Base URL");
  }

  const genderStr = input.gender === Gender.MALE ? '男 (乾造)' : '女 (坤造)';
  const startAgeInt = parseInt(input.startAge) || 1;
  
  // Calculate Da Yun Direction accurately
  const yearStemPolarity = getStemPolarity(input.yearPillar);
  let isForward = false;

  if (input.gender === Gender.MALE) {
    isForward = yearStemPolarity === 'YANG';
  } else {
    isForward = yearStemPolarity === 'YIN';
  }

  const daYunDirectionStr = isForward ? '顺行 (Forward)' : '逆行 (Backward)';
  
  const directionExample = isForward 
    ? "例如：第一步是【戊申】，第二步则是【己酉】（顺排）" 
    : "例如：第一步是【戊申】，第二步则是【丁未】（逆排）";

  const userPrompt = `
    请根据以下**已经排好的**八字四柱和**指定的大运信息**进行分析。
    
    【基本信息】
    性别：${genderStr}
    姓名：${input.name || "未提供"}
    出生年份：${input.birthYear}年 (阳历)
    
    【八字四柱】
    年柱：${input.yearPillar} (天干属性：${yearStemPolarity === 'YANG' ? '阳' : '阴'})
    月柱：${input.monthPillar}
    日柱：${input.dayPillar}
    时柱：${input.hourPillar}
    
    【大运核心参数】
    1. 起运年龄：${input.startAge} 岁 (虚岁)。
    2. 第一步大运：${input.firstDaYun}。
    3. **排序方向**：${daYunDirectionStr}。
    
    【必须执行的算法 - 大运序列生成】
    请严格按照以下步骤生成数据：
    
    1. **锁定第一步**：确认【${input.firstDaYun}】为第一步大运。
    2. **计算序列**：根据六十甲子顺序和方向（${daYunDirectionStr}），推算出接下来的 9 步大运。
       ${directionExample}
    3. **填充 JSON**：
       - Age 1 到 ${startAgeInt - 1}: daYun = "童限"
       - Age ${startAgeInt} 到 ${startAgeInt + 9}: daYun = [第1步大运: ${input.firstDaYun}]
       - Age ${startAgeInt + 10} 到 ${startAgeInt + 19}: daYun = [第2步大运]
       - Age ${startAgeInt + 20} 到 ${startAgeInt + 29}: daYun = [第3步大运]
       - ...以此类推直到 100 岁。
    
    【特别警告】
    - **daYun 字段**：必须填大运干支（10年一变），**绝对不要**填流年干支。
    - **ganZhi 字段**：填入该年份的**流年干支**（每年一变，例如 2024=甲辰，2025=乙巳）。
    
    任务：
    1. 确认格局与喜忌。
    2. 生成 **1-100 岁 (虚岁)** 的人生流年K线数据。
    3. 在 \`reason\` 字段中提供流年详批。
    4. 生成带评分的命理分析报告（包含性格分析、币圈交易分析、发展风水分析）。
    
    请严格按照系统指令生成 JSON 数据。
  `;

  try {
    const response = await fetch(`${cleanBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cleanApiKey}`
      },
      body: JSON.stringify({
        model: targetModel, 
        messages: [
          { role: "system", content: BAZI_SYSTEM_INSTRUCTION },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API 请求失败: ${response.status} - ${errText}`);
    }

    const jsonResult = await response.json();
    let content = jsonResult.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("模型未返回任何内容。");
    }

    // 清理可能的markdown代码块标记
    // 移除开头的 ```json 或 ``` 标记
    content = content.trim();
    if (content.startsWith('```')) {
      // 找到第一个换行符，移除开头的代码块标记行
      const firstNewline = content.indexOf('\n');
      if (firstNewline !== -1) {
        content = content.substring(firstNewline + 1);
      } else {
        // 如果没有换行符，直接移除开头的 ```
        content = content.replace(/^```(?:json)?/i, '');
      }
    }
    // 移除结尾的 ``` 标记
    if (content.endsWith('```')) {
      content = content.substring(0, content.length - 3);
    }
    content = content.trim();

    // 解析 JSON
    let data;
    try {
      data = JSON.parse(content);
    } catch (parseError) {
      // 如果解析失败，尝试提取JSON对象
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          data = JSON.parse(jsonMatch[0]);
        } catch (retryError) {
          throw new Error(`模型返回的数据不是有效的JSON格式: ${parseError instanceof Error ? parseError.message : '未知错误'}。原始内容预览: ${content.substring(0, 200)}...`);
        }
      } else {
        throw new Error(`模型返回的数据不是有效的JSON格式: ${parseError instanceof Error ? parseError.message : '未知错误'}。原始内容预览: ${content.substring(0, 200)}...`);
      }
    }

    // 简单校验数据完整性
    if (!data.chartPoints || !Array.isArray(data.chartPoints)) {
      throw new Error("模型返回的数据格式不正确（缺失 chartPoints）。");
    }

    // 确保所有字符串字段都是字符串类型
    const ensureString = (value: any, defaultValue: string): string => {
      if (value === null || value === undefined) return defaultValue;
      return String(value);
    };

    const ensureNumber = (value: any, defaultValue: number): number => {
      if (value === null || value === undefined) return defaultValue;
      const num = Number(value);
      return isNaN(num) ? defaultValue : num;
    };

    return {
      chartData: data.chartPoints,
      analysis: {
        bazi: Array.isArray(data.bazi) ? data.bazi.map(String) : [],
        summary: ensureString(data.summary, "无摘要"),
        summaryScore: ensureNumber(data.summaryScore, 5),
        personality: ensureString(data.personality, "无性格分析"),
        personalityScore: ensureNumber(data.personalityScore, 5),
        industry: ensureString(data.industry, "无"),
        industryScore: ensureNumber(data.industryScore, 5),
        fengShui: ensureString(data.fengShui, "建议多亲近自然，保持心境平和。"),
        fengShuiScore: ensureNumber(data.fengShuiScore, 5),
        wealth: ensureString(data.wealth, "无"),
        wealthScore: ensureNumber(data.wealthScore, 5),
        marriage: ensureString(data.marriage, "无"),
        marriageScore: ensureNumber(data.marriageScore, 5),
        health: ensureString(data.health, "无"),
        healthScore: ensureNumber(data.healthScore, 5),
        family: ensureString(data.family, "无"),
        familyScore: ensureNumber(data.familyScore, 5),
        // Crypto Fields
        crypto: ensureString(data.crypto, "暂无交易分析"),
        cryptoScore: ensureNumber(data.cryptoScore, 5),
        cryptoYear: ensureString(data.cryptoYear, "待定"),
        cryptoStyle: ensureString(data.cryptoStyle, "现货定投"),
      },
    };
  } catch (error) {
    console.error("Gemini/OpenAI API Error:", error);
    
    // 提供更友好的错误信息
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      throw new Error("无法连接到API服务器。请检查：\n1. API Base URL是否正确\n2. 网络连接是否正常\n3. API服务是否可用");
    }
    
    if (error instanceof Error) {
      throw error;
    }
    
    throw new Error(`API调用失败: ${String(error)}`);
  }
};
